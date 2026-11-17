/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

/** 下线结论记录：同一事件同一时间只允许一条「生效中」的下线结论落库。 */
export type OfflineConclusion = {
  eventNo: string
  eventId: number
  source: string
  at: string
  state: '生效中' | '已关闭'
  closedAt?: string
}

/** 失效差异清单条目：事件下线导致参数转只读的历史差异，追加保留、不覆盖。 */
export type ContractDiffEntry = {
  eventNo: string
  paramNo: string
  paramId: number
  fromStatus: string
  toStatus: string
  reason: string
  at: string
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
