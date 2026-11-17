/**
 * 复现 EVEN-0003 状态错位：事件下线后参数仍显示为可用。
 * 在 Node 里跑（无 window，localStorage 自动退化为内存缓存）。
 */
import { listEntries, runAction } from '@/api/local-service'
import { listRows, resetRows } from '@/data/local-store'

function show(tag: string) {
  const event = listRows('eventspec').find((r) => r['事件编号'] === 'EVEN-0003')
  const param = listRows('paramdef').find((r) => r['参数编号'] === 'PARA-0003')
  const trace = listRows('eventtrace').find((r) => r['链路编号'] === 'EVEN-0003')
  console.log(`[${tag}] EVEN-0003 事件状态=${event?.status} abnormal=${event?.abnormal}`)
  console.log(`[${tag}] PARA-0003 参数状态=${param?.status} abnormal=${param?.abnormal} 所属事件=${param?.['所属事件']}`)
  console.log(`[${tag}] EVEN-0003 来源记录 abnormal=${trace?.abnormal}`)
}

resetRows('eventspec')
resetRows('paramdef')
resetRows('eventtrace')
show('初始')

const r1 = runAction('eventspec', 3, '下线事件')
console.log('下线事件回执:', JSON.stringify(r1))
show('下线后')

// 故障断言：事件已下线，但参数仍是「已发布」（可用），即状态错位
const param = listRows('paramdef').find((r) => r['参数编号'] === 'PARA-0003')
if (param && String(param.status) === '已发布') {
  console.log('>>> 故障复现：EVEN-0003 已下线，PARA-0003 仍显示为可用（已发布）')
} else {
  console.log('>>> 未复现：参数已随事件下线收敛为', param?.status)
}

// 尝试重新激活已下线事件的参数
const r2 = runAction('paramdef', 3, '发布参数')
console.log('参数重新发布回执:', JSON.stringify(r2))

// 并发/重复下线
const r3 = runAction('eventspec', 3, '下线事件')
console.log('重复下线回执:', JSON.stringify(r3))

console.log('参数字典列表总数:', listEntries('paramdef').total)
