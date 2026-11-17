import { SEED_ROWS } from './seed'
import type { ContractDiffEntry, EntryRow, OfflineConclusion } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'behavior-event-trace-hub:entries'
// 发布链路的两份台账：下线结论（下线记录）与失效差异清单，追加保留历史。
const OFFLINE_CONCLUSIONS_KEY = 'behavior-event-trace-hub:offline-conclusions'
const CONTRACT_DIFFS_KEY = 'behavior-event-trace-hub:param-contract-diffs'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readJsonList<T>(key: string): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeJsonList<T>(key: string, value: T[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
}

let offlineConclusionsCache: OfflineConclusion[] | null = null
let contractDiffsCache: ContractDiffEntry[] | null = null

export function listOfflineConclusions(): OfflineConclusion[] {
  if (offlineConclusionsCache === null) {
    offlineConclusionsCache = readJsonList<OfflineConclusion>(OFFLINE_CONCLUSIONS_KEY)
  }
  return offlineConclusionsCache
}

export function saveOfflineConclusions(rows: OfflineConclusion[]): void {
  offlineConclusionsCache = rows
  writeJsonList(OFFLINE_CONCLUSIONS_KEY, rows)
}

export function listContractDiffs(): ContractDiffEntry[] {
  if (contractDiffsCache === null) {
    contractDiffsCache = readJsonList<ContractDiffEntry>(CONTRACT_DIFFS_KEY)
  }
  return contractDiffsCache
}

export function appendContractDiffs(entries: ContractDiffEntry[]): void {
  if (entries.length === 0) {
    return
  }
  const next = [...listContractDiffs(), ...entries]
  contractDiffsCache = next
  writeJsonList(CONTRACT_DIFFS_KEY, next)
}
