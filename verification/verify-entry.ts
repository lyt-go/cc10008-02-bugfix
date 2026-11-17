/**
 * 发布链路修复验证：
 * 1) 复现 EVEN-0003 状态错位并修复；2) 下线级联（参数只读+差异清单+来源记录）；
 * 3) 并发下线只落一份结论；4) 重复发布转契约冲突；5) 重取发布契约幂等；
 * 6) 版本冲突仲裁边界；7) 跨模块反映。
 */
import {
  listContractDiffs,
  listOfflineConclusions,
  publishedParamContract,
  repairParamContracts,
  runAction,
} from '@/api/local-service'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}
function row(key: string, field: string, no: string): EntryRow {
  const found = listRows(key).find((r) => String(r[field]) === no)
  if (!found) throw new Error(`missing ${key}/${no}`)
  return found
}
const event3 = () => row('eventspec', '事件编号', 'EVEN-0003')
const param3 = () => row('paramdef', '参数编号', 'PARA-0003')
const trace3 = () => row('eventtrace', '链路编号', 'EVEN-0003')
const openConclusions = () =>
  listOfflineConclusions().filter((c) => c.eventNo === 'EVEN-0003' && c.state === '生效中')
const diffsOf = (no: string) => listContractDiffs().filter((d) => d.eventNo === no)

console.log('== 场景1：复现 EVEN-0003 状态错位（故障数据直接落库），修复后核对三处来源 ==')
resetRows('eventspec')
resetRows('paramdef')
resetRows('eventtrace')
// 模拟故障期的错位数据：事件已下线，参数仍可发布，且无异常标记
saveRows('eventspec', listRows('eventspec').map((r) => (r.id === 3 ? { ...r, status: '已下线', pending: false, abnormal: false } : r)))
check('错位复现：事件已下线', String(event3().status) === '已下线')
check('错位复现：参数仍可用（已发布）', String(param3().status) === '已发布')
const before = repairParamContracts()
check('修复定位到 1 处异常', before.repaired.length === 1, JSON.stringify(before.repaired))
check('三处来源①下线记录落库', openConclusions().length === 1, JSON.stringify(listOfflineConclusions()))
check('三处来源②参数转只读（已废弃）', String(param3().status) === '已废弃' && param3().abnormal === true)
check('三处来源③失效差异清单留存', diffsOf('EVEN-0003').length === 1 && diffsOf('EVEN-0003')[0].fromStatus === '已发布' && diffsOf('EVEN-0003')[0].toStatus === '已废弃')
check('跨模块反映：埋点事件契约标记异常', event3().abnormal === true)
check('跨模块反映：契约来源记录标记异常', trace3().abnormal === true)
check('下游看不到已下线事件的可发布参数', publishedParamContract('EVEN-0003').params.length === 0 && publishedParamContract('EVEN-0003').readonly)

console.log('== 场景2：再次提交修复请求，只保留一份结论，其余回执转埋点事件契约冲突 ==')
const again = repairParamContracts()
check('重复修复幂等：无新增修复', again.repaired.length === 0)
check('重复修复回执转为契约冲突', again.conflicts.length === 1 && again.conflicts[0].includes('埋点事件契约冲突'))
check('差异清单不重复落库', diffsOf('EVEN-0003').length === 1)
check('下线结论仍只有一份', openConclusions().length === 1)

console.log('== 场景3：并发下线同一事件，只允许一个下线结论落库 ==')
resetRows('eventspec')
resetRows('paramdef')
resetRows('eventtrace')
const diffsBefore = diffsOf('EVEN-0003').length
const r1 = runAction('eventspec', 3, '下线事件')
const r2 = runAction('eventspec', 3, '下线事件') // 并发重复请求
check('第一个下线请求成功', r1.ok)
check('第二个下线请求被拒绝', !r2.ok && r2.message.includes('已存在下线结论'), r2.message)
check('只落一份下线结论', openConclusions().length === 1, JSON.stringify(listOfflineConclusions()))
check('参数未被重新激活（保持只读）', String(param3().status) === '已废弃')
check('级联差异清单生成（本次新增一条）', diffsOf('EVEN-0003').length === diffsBefore + 1)

console.log('== 场景4：已下线事件的参数不能重新激活 ==')
const pub = runAction('paramdef', 3, '发布参数')
const review = runAction('paramdef', 3, '提交字典评审')
check('发布参数被拒绝（契约冲突）', !pub.ok && pub.message.includes('埋点事件契约冲突'), pub.message)
check('提交字典评审被拒绝（契约冲突）', !review.ok && review.message.includes('埋点事件契约冲突'), review.message)
check('参数仍是只读终态', String(param3().status) === '已废弃')
const retire = runAction('paramdef', 3, '废弃参数')
check('重复收敛到只读态被拒绝且不写库', !retire.ok)

console.log('== 场景5：重复发布只保留一份发布版契约 ==')
const p1 = runAction('paramdef', 1, '发布参数') // PARA-0001 所属 EVEN-0001（草稿），可发布
const p2 = runAction('paramdef', 1, '发布参数')
check('首次发布成功', p1.ok)
check('重复发布转为契约冲突', !p2.ok && p2.message.includes('埋点事件契约冲突'), p2.message)
check('发布版契约只有一份', publishedParamContract('EVEN-0001').params.filter((r) => r['参数编号'] === 'PARA-0001').length === 1)

console.log('== 场景6：版本冲突仲裁边界（先形成下线终态） ==')
resetRows('eventspec')
resetRows('paramdef')
resetRows('eventtrace')
runAction('paramdef', 3, '废弃参数') // 先让 PARA-0003 离开已发布，验证重新发布 vs 下线
const rePub = runAction('paramdef', 3, '发布参数')
check('事件在线时参数可重新发布', rePub.ok)
runAction('eventspec', 3, '下线事件')
check('下线后参数立即只读', String(param3().status) === '已废弃')
check('失效差异清单记录本次差异', diffsOf('EVEN-0003').some((d) => d.fromStatus === '已发布' && d.toStatus === '已废弃'))
const latePub = runAction('paramdef', 3, '发布参数')
check('下线后的重新发布请求被拒绝', !latePub.ok)
check('不变量：下游永远看不到已下线事件的可发布参数', publishedParamContract('EVEN-0003').params.length === 0)

console.log('== 场景7：事件重新发布后下线结论关闭，历史差异保留 ==')
const rePubEvent = runAction('eventspec', 3, '发布事件')
check('事件可重新发布', rePubEvent.ok)
check('生效中下线结论已关闭', openConclusions().length === 0)
check('历史下线记录保留', listOfflineConclusions().some((c) => c.eventNo === 'EVEN-0003' && c.state === '已关闭'))
check('历史差异清单保留', diffsOf('EVEN-0003').length >= 1)
check('参数不自动复活（仍是只读，需人工重新发布）', String(param3().status) === '已废弃')

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
