/** 带 localStorage 的持久化路径验证：台账写盘、刷新后仍在。 */
// @ts-nocheck
const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  },
}
const { runAction, listOfflineConclusions, listContractDiffs, repairParamContracts } = await import('@/api/local-service')
const { resetRows } = await import('@/data/local-store')

resetRows('eventspec'); resetRows('paramdef'); resetRows('eventtrace')
runAction('eventspec', 3, '下线事件')
const offlineKey = 'behavior-event-trace-hub:offline-conclusions'
const diffKey = 'behavior-event-trace-hub:param-contract-diffs'
const entriesKey = 'behavior-event-trace-hub:entries'
console.log('localStorage 写入键:', [...store.keys()].join(', '))
console.log('下线记录落盘:', store.get(offlineKey))
console.log('差异清单落盘:', store.get(diffKey))
const entries = JSON.parse(store.get(entriesKey))
console.log('PARA-0003 落盘状态:', entries.paramdef.find((r) => r['参数编号'] === 'PARA-0003').status)
console.log('EVEN-0003 来源记录落盘 abnormal:', entries.eventtrace.find((r) => r['链路编号'] === 'EVEN-0003').abnormal)
console.log('台账读取一致:', listOfflineConclusions().length === 1 && listContractDiffs().length === 1)
const again = repairParamContracts()
console.log('重复修复幂等:', again.repaired.length === 0 && listContractDiffs().length === 1)
