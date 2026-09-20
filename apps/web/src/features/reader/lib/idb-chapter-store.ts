import type { ChapterTextEntry } from './chapter-text-cache'

// Minimal hand-rolled IndexedDB access for the chapter-text cache (see
// chapter-text-cache.ts). All failures degrade to "no cache": open errors,
// missing indexedDB (SSR/jsdom), and quota refusals resolve as misses.

export interface ChapterTextStore {
  get(key: string): Promise<ChapterTextEntry | undefined>
  put(key: string, text: string): Promise<void>
  /** Evict least-recently-read entries of `namespace` until it fits `budgetBytes`. */
  enforceBudget(namespace: string, budgetBytes: number): Promise<void>
}

const DB_NAME = 'bookdock-chapter-text'
const DB_VERSION = 1
const STORE = 'text'
const NS_INDEX = 'ns'

interface ChapterTextRecord {
  key: string
  ns: string
  text: string
  /** UTF-16 weight of `text`, kept denormalized for cheap budget sums */
  bytes: number
  savedAt: number
  lastReadAt: number
}

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION)
      } catch {
        resolve(null)
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex(NS_INDEX, 'ns')
        }
      }
      // A permanently failing open must not poison the cache forever
      req.onerror = () => {
        dbPromise = null
        resolve(null)
      }
      req.onblocked = () => {
        dbPromise = null
        resolve(null)
      }
      req.onsuccess = () => resolve(req.result)
    })
  }
  return dbPromise
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('idb transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('idb transaction failed'))
  })
}

function toEntry(record: ChapterTextRecord | undefined): ChapterTextEntry | undefined {
  if (!record || typeof record.text !== 'string' || !record.text) return undefined
  return { key: record.key, text: record.text }
}

export const idbChapterTextStore: ChapterTextStore = {
  async get(key) {
    const db = await openDB()
    if (!db) return undefined
    let record: ChapterTextRecord | undefined
    try {
      record = await new Promise<ChapterTextRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(key)
        tx.oncomplete = () => resolve(req.result as ChapterTextRecord | undefined)
        tx.onerror = () => reject(tx.error ?? new Error('idb get failed'))
        tx.onabort = () => reject(tx.error ?? new Error('idb get aborted'))
      })
    } catch {
      return undefined
    }
    const entry = toEntry(record)
    if (entry && record) {
      // LRU touch without rewriting the payload (same keyPath, full record)
      const touched: ChapterTextRecord = { ...record, lastReadAt: Date.now() }
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(touched)
        void txDone(tx).catch(() => {})
      } catch {
        // touch is best-effort
      }
    }
    return entry
  },

  async put(key, text) {
    const db = await openDB()
    if (!db) return
    try {
      const ns = key.slice(0, key.lastIndexOf('|'))
      const now = Date.now()
      const record: ChapterTextRecord = {
        key,
        ns,
        text,
        bytes: text.length * 2,
        savedAt: now,
        lastReadAt: now,
      }
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record)
      await txDone(tx)
    } catch {
      // quota/private-mode refusals just mean "nothing cached"
    }
  },

  async enforceBudget(namespace, budgetBytes) {
    const db = await openDB()
    if (!db) return
    try {
      const records = await new Promise<ChapterTextRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).index(NS_INDEX).getAll(IDBKeyRange.only(namespace))
        tx.oncomplete = () => resolve((req.result as ChapterTextRecord[]) ?? [])
        tx.onerror = () => reject(tx.error ?? new Error('idb getAll failed'))
        tx.onabort = () => reject(tx.error ?? new Error('idb getAll aborted'))
      })
      let total = records.reduce((sum, r) => sum + (r.bytes ?? 0), 0)
      if (total <= budgetBytes) return
      const leastRecent = [...records].sort((a, b) => (a.lastReadAt ?? a.savedAt) - (b.lastReadAt ?? b.savedAt))
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const record of leastRecent) {
        if (total <= budgetBytes) break
        store.delete(record.key)
        total -= record.bytes ?? 0
      }
      await txDone(tx)
    } catch {
      // budget enforcement is best-effort
    }
  },
}
