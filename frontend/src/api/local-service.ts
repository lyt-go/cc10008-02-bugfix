import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  appendContractDiffs,
  listContractDiffs,
  listOfflineConclusions,
  listRows,
  resetRows,
  saveOfflineConclusions,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  ContractDiffEntry,
  EntryRow,
  ModuleMeta,
  OfflineConclusion,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '废弃']

// 发布链路约定：事件规范是埋点事件契约，参数字典是发布版事件参数契约，
// 事件溯源是埋点事件契约来源记录；参数通过「所属事件」引用事件定义的「事件编号」。
const EVENTSPEC_KEY = 'eventspec'
const PARAMDEF_KEY = 'paramdef'
const EVENTTRACE_KEY = 'eventtrace'
const EVENT_OFFLINE_STATUS = '已下线'
const PARAM_READONLY_STATUS = '已废弃'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === target) {
    return duplicateConclusionReceipt(meta, row, action, target)
  }
  // 只读守卫：已下线事件的参数不能重新激活，只允许继续收敛到只读终态。
  if (key === PARAMDEF_KEY) {
    const conflict = paramReadonlyConflict(row, action, target)
    if (conflict) {
      return conflict
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 发布链路级联：事件下线先形成终态，参数立即转只读并生成失效差异清单。
  if (key === EVENTSPEC_KEY) {
    const eventNo = String(updated['事件编号'] ?? '')
    if (target === EVENT_OFFLINE_STATUS) {
      ensureOfflineConclusion(updated, action)
      cascadeEventOffline(eventNo, action)
    } else {
      closeOfflineConclusion(eventNo)
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 重复结论仲裁：同一事件只落一份下线结论、同一参数只留一份发布版契约，
// 其余回执转为埋点事件契约冲突；被拒绝的请求不写库，参数不会被重新激活。
function duplicateConclusionReceipt(
  meta: ModuleMeta,
  row: EntryRow,
  action: string,
  target: string,
): ActionResult {
  const rowNo = String(row[meta.fields[0]] ?? row.id)
  if (action === '下线事件') {
    return {
      ok: false,
      message: `事件「${rowNo}」已存在下线结论，并发下线请求被拒绝，参数保持只读`,
    }
  }
  if (action.startsWith('发布')) {
    return {
      ok: false,
      message: `埋点事件契约冲突：${meta.entity}「${rowNo}」已是「${target}」，只保留一份发布版事件参数契约`,
    }
  }
  return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
}

// 已下线事件的参数转为只读：除收敛到「已废弃」外的流转一律拒绝。
function paramReadonlyConflict(row: EntryRow, action: string, target: string): ActionResult | null {
  const eventNo = String(row['所属事件'] ?? '')
  if (!eventNo || target === PARAM_READONLY_STATUS) {
    return null
  }
  const event = findEventByNo(eventNo)
  if (!event || String(event.status) !== EVENT_OFFLINE_STATUS) {
    return null
  }
  return {
    ok: false,
    message: `埋点事件契约冲突：事件「${eventNo}」已下线，参数「${String(
      row['参数编号'] ?? row.id,
    )}」已转只读，「${action}」被拒绝`,
  }
}

function findEventByNo(eventNo: string): EntryRow | undefined {
  if (!eventNo) {
    return undefined
  }
  return listRows(EVENTSPEC_KEY).find((row) => String(row['事件编号'] ?? '') === eventNo)
}

function now(): string {
  return new Date().toISOString()
}

function openOfflineConclusion(eventNo: string): OfflineConclusion | undefined {
  return listOfflineConclusions().find((item) => item.eventNo === eventNo && item.state === '生效中')
}

// 下线记录落库：同一事件只保留一条生效中的下线结论，重复请求不再追加。
function ensureOfflineConclusion(event: EntryRow, source: string): void {
  const eventNo = String(event['事件编号'] ?? '')
  if (!eventNo || openOfflineConclusion(eventNo)) {
    return
  }
  saveOfflineConclusions([
    ...listOfflineConclusions(),
    { eventNo, eventId: Number(event.id), source, at: now(), state: '生效中' },
  ])
}

// 事件离开下线终态（重新发布或退回评审）时，关闭生效中的下线结论，历史记录保留。
function closeOfflineConclusion(eventNo: string): void {
  const rows = listOfflineConclusions()
  if (!rows.some((item) => item.eventNo === eventNo && item.state === '生效中')) {
    return
  }
  saveOfflineConclusions(
    rows.map((item) =>
      item.eventNo === eventNo && item.state === '生效中'
        ? { ...item, state: '已关闭', closedAt: now() }
        : item,
    ),
  )
}

// 级联：已下线事件的参数立即转只读（已废弃），差异写进失效差异清单，
// 修复结果跨模块反映到埋点事件契约来源记录（事件溯源标记异常）。
function cascadeEventOffline(eventNo: string, source: string): ContractDiffEntry[] {
  const diffs: ContractDiffEntry[] = []
  const params = listRows(PARAMDEF_KEY)
  let paramsChanged = false
  const nextParams = params.map((param) => {
    if (String(param['所属事件'] ?? '') !== eventNo || String(param.status) === PARAM_READONLY_STATUS) {
      return param
    }
    paramsChanged = true
    diffs.push({
      eventNo,
      paramNo: String(param['参数编号'] ?? param.id),
      paramId: Number(param.id),
      fromStatus: String(param.status),
      toStatus: PARAM_READONLY_STATUS,
      reason: `事件「${eventNo}」已下线，参数转只读（${source}）`,
      at: now(),
    })
    return { ...param, status: PARAM_READONLY_STATUS, pending: false, abnormal: true }
  })
  if (paramsChanged) {
    saveRows(PARAMDEF_KEY, nextParams)
  }
  const traces = listRows(EVENTTRACE_KEY)
  let tracesChanged = false
  const nextTraces = traces.map((trace) => {
    if (String(trace['链路编号'] ?? '') !== eventNo || trace.abnormal) {
      return trace
    }
    tracesChanged = true
    return { ...trace, abnormal: true }
  })
  if (tracesChanged) {
    saveRows(EVENTTRACE_KEY, nextTraces)
  }
  appendContractDiffs(diffs)
  return diffs
}

export type ParamContractRepairResult = {
  ok: boolean
  repaired: { eventNo: string; paramNo: string; fromStatus: string; toStatus: string }[]
  conflicts: string[]
  diffs: ContractDiffEntry[]
  message: string
}

// 参数字典重取发布版事件参数契约：按事件定义定位「事件已下线、参数仍可发布」的异常，
// 修复结果跨模块反映到埋点事件契约与契约来源记录。重复提交幂等：只保留一份修复结论，
// 已收敛的参数回执转为埋点事件契约冲突，差异清单不重复落库。
export function repairParamContracts(): ParamContractRepairResult {
  const events = listRows(EVENTSPEC_KEY)
  const offlineEvents = events.filter((row) => String(row.status) === EVENT_OFFLINE_STATUS)
  const repaired: ParamContractRepairResult['repaired'] = []
  const conflicts: string[] = []
  const diffs: ContractDiffEntry[] = []
  if (offlineEvents.length === 0) {
    return { ok: true, repaired, conflicts, diffs, message: '没有已下线事件，发布版事件参数契约无需修复' }
  }
  // 反映到埋点事件契约：已下线事件保持异常标记。
  let eventsChanged = false
  const nextEvents = events.map((row) => {
    if (String(row.status) === EVENT_OFFLINE_STATUS && !row.abnormal) {
      eventsChanged = true
      return { ...row, abnormal: true }
    }
    return row
  })
  if (eventsChanged) {
    saveRows(EVENTSPEC_KEY, nextEvents)
  }
  for (const event of offlineEvents) {
    const eventNo = String(event['事件编号'] ?? '')
    ensureOfflineConclusion(event, '修复恢复')
    const linked = listRows(PARAMDEF_KEY).filter((row) => String(row['所属事件'] ?? '') === eventNo)
    diffs.push(...cascadeEventOffline(eventNo, '修复恢复'))
    for (const param of linked) {
      if (String(param.status) === PARAM_READONLY_STATUS) {
        conflicts.push(`参数「${String(param['参数编号'] ?? param.id)}」已只读，重复修复回执转为埋点事件契约冲突`)
      } else {
        repaired.push({
          eventNo,
          paramNo: String(param['参数编号'] ?? param.id),
          fromStatus: String(param.status),
          toStatus: PARAM_READONLY_STATUS,
        })
      }
    }
  }
  const message =
    repaired.length > 0
      ? `已按事件定义定位 ${repaired.length} 处参数契约异常，参数转只读并留存失效差异清单`
      : '发布版事件参数契约已收敛，重复修复回执已转为埋点事件契约冲突'
  return { ok: true, repaired, conflicts, diffs, message }
}

export type PublishedParamContract = {
  eventNo: string
  eventStatus: string
  readonly: boolean
  params: EntryRow[]
}

// 下游读取发布版事件参数契约的唯一入口：已下线事件的参数永远不可发布。
export function publishedParamContract(eventNo: string): PublishedParamContract {
  const event = findEventByNo(eventNo)
  const eventStatus = event ? String(event.status) : ''
  const readonly = eventStatus === EVENT_OFFLINE_STATUS
  const params = readonly
    ? []
    : listRows(PARAMDEF_KEY).filter(
        (row) => String(row['所属事件'] ?? '') === eventNo && String(row.status) === '已发布',
      )
  return { eventNo, eventStatus, readonly, params }
}

export { listContractDiffs, listOfflineConclusions }

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
