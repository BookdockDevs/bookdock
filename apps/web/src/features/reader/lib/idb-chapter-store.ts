import type { ChapterTextEntry } from './chapter-text-cache'

// Minimal hand-rolled IndexedDB access for the chapter-text cache (see
// chapter-text-cache.ts). All failures degrade to "no cache": open errors,
// missing indexedDB (SSR/jsdom), and quota refusals resolve as misses.

export interface ChapterTextStore {
  get(key: string): Promise<ChapterTextEntry | undefined>
  put(key: string, text: string, canWrite?: () => boolean): Promise<void>
  /** Evict least-recently-read entries until the whole reader store fits `budgetBytes`. */
  enforceBudget(namespace: string, budgetBytes: number): Promise<void>
}

export interface ReaderBlobEntry {
  data: ArrayBuffer
  mediaType: string
}

export interface ReaderBlobStore {
  get(key: string): Promise<ReaderBlobEntry | undefined>
  put(key: string, data: ArrayBuffer, mediaType: string, canWrite?: () => boolean): Promise<void>
}

export const READER_CONTENT_BUDGET_BYTES = 256 * 1024 * 1024

const DB_NAME = 'bookdock-chapter-text'
const DB_VERSION = 3
const STORE = 'text'
const BLOB_STORE = 'blob'
const META_STORE = 'reader-meta'
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

interface ReaderBlobRecord {
  key: string
  ns: string
  data: ArrayBuffer
  mediaType: string
  bytes: number
  savedAt: number
  lastReadAt: number
}

interface ReaderBudgetRecord {
  key: string
  store: typeof STORE | typeof BLOB_STORE
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
      let settledUnavailable = false
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
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          const store = db.createObjectStore(BLOB_STORE, { keyPath: 'key' })
          store.createIndex(NS_INDEX, 'ns')
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' })
          const tx = req.transaction
          if (tx) {
            for (const storeName of [STORE, BLOB_STORE] as const) {
              const cursorRequest = tx.objectStore(storeName).openCursor()
              cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result
                if (!cursor) return
                const record = cursor.value as ChapterTextRecord | ReaderBlobRecord
                tx.objectStore(META_STORE).put({
                  key: record.key,
                  store: storeName,
                  bytes: record.bytes ?? (storeName === STORE
                    ? ((record as ChapterTextRecord).text?.length ?? 0) * 2
                    : ((record as ReaderBlobRecord).data?.byteLength ?? 0)),
                  savedAt: record.savedAt ?? 0,
                  lastReadAt: record.lastReadAt ?? record.savedAt ?? 0,
                } satisfies ReaderBudgetRecord)
                cursor.continue()
              }
            }
          }
        }
      }
      // A permanently failing open must not poison the cache forever
      req.onerror = () => {
        settledUnavailable = true
        dbPromise = null
        resolve(null)
      }
      req.onblocked = () => {
        settledUnavailable = true
        // Keep the resolved miss until this open finishes. Retrying while its
        // upgrade is still blocked queues another open that may never emit
        // its own blocked event, leaving later cache callers waiting forever.
        resolve(null)
      }
      req.onsuccess = () => {
        if (settledUnavailable) {
          req.result.close()
          dbPromise = null
          return
        }
        req.result.onversionchange = () => {
          req.result.close()
          dbPromise = null
        }
        resolve(req.result)
      }
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

async function enforceWholeReaderBudget(db: IDBDatabase, budgetBytes: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, BLOB_STORE, META_STORE], 'readwrite')
    const metadata = tx.objectStore(META_STORE)
    const records: ReaderBudgetRecord[] = []
    let total = 0
    const cursorRequest = metadata.openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (cursor) {
        const record = cursor.value as ReaderBudgetRecord
        records.push(record)
        total += record.bytes ?? 0
        cursor.continue()
        return
      }
      if (total <= budgetBytes) return
      records.sort((a, b) => a.lastReadAt - b.lastReadAt || a.savedAt - b.savedAt)
      for (const record of records) {
        if (total <= budgetBytes) break
        tx.objectStore(record.store).delete(record.key)
        metadata.delete(record.key)
        total -= record.bytes
      }
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('idb budget transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('idb budget transaction failed'))
  })
}

let budgetRun: Promise<void> | null = null
let cacheMutationVersion = 0
let budgetTarget = Number.POSITIVE_INFINITY

function requestBudget(db: IDBDatabase, budgetBytes: number): Promise<void> {
  if (budgetRun) {
    budgetTarget = Math.min(budgetTarget, budgetBytes)
    return budgetRun
  }
  budgetTarget = budgetBytes
  budgetRun = (async () => {
    let checkedVersion: number
    let checkedBudget: number
    do {
      checkedVersion = cacheMutationVersion
      checkedBudget = budgetTarget
      await enforceWholeReaderBudget(db, checkedBudget)
    } while (checkedVersion !== cacheMutationVersion || checkedBudget !== budgetTarget)
  })().finally(() => { budgetRun = null; budgetTarget = Number.POSITIVE_INFINITY })
  return budgetRun
}

function touchTextRecord(db: IDBDatabase, record: ChapterTextRecord): void {
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    const store = tx.objectStore(META_STORE)
    const request = store.get(record.key)
    request.onsuccess = () => {
      const metadata = request.result as ReaderBudgetRecord | undefined
      if (metadata?.store === STORE) store.put({ ...metadata, lastReadAt: Date.now() })
    }
    void txDone(tx).catch(() => {})
  } catch {
    // touch is best-effort
  }
}

function touchBlobRecord(db: IDBDatabase, record: ReaderBlobRecord): void {
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    const store = tx.objectStore(META_STORE)
    const request = store.get(record.key)
    request.onsuccess = () => {
      const metadata = request.result as ReaderBudgetRecord | undefined
      if (metadata?.store === BLOB_STORE) store.put({ ...metadata, lastReadAt: Date.now() })
    }
    void txDone(tx).catch(() => {})
  } catch {
    // touch is best-effort
  }
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
    if (entry && record) touchTextRecord(db, record)
    return entry
  },

  async put(key, text, canWrite) {
    const db = await openDB()
    if (!db || (canWrite && !canWrite())) return
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
      const tx = db.transaction([STORE, META_STORE], 'readwrite')
      tx.objectStore(STORE).put(record)
      tx.objectStore(META_STORE).put({
        key, store: STORE, bytes: record.bytes, savedAt: now, lastReadAt: now,
      } satisfies ReaderBudgetRecord)
      await txDone(tx)
      cacheMutationVersion += 1
    } catch {
      // quota/private-mode refusals just mean "nothing cached"
    }
  },

  async enforceBudget(_namespace, budgetBytes) {
    const db = await openDB()
    if (!db) return
    try {
      await requestBudget(db, budgetBytes)
    } catch {
      // budget enforcement is best-effort
    }
  },
}

export const idbReaderBlobStore: ReaderBlobStore = {
  async get(key) {
    const db = await openDB()
    if (!db) return undefined
    let record: ReaderBlobRecord | undefined
    try {
      record = await new Promise<ReaderBlobRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(BLOB_STORE, 'readonly')
        const req = tx.objectStore(BLOB_STORE).get(key)
        tx.oncomplete = () => resolve(req.result as ReaderBlobRecord | undefined)
        tx.onerror = () => reject(tx.error ?? new Error('idb get failed'))
        tx.onabort = () => reject(tx.error ?? new Error('idb get aborted'))
      })
    } catch {
      return undefined
    }
    if (!record || !(record.data instanceof ArrayBuffer) || !record.data.byteLength) return undefined
    touchBlobRecord(db, record)
    return { data: record.data, mediaType: record.mediaType }
  },

  async put(key, data, mediaType, canWrite) {
    const db = await openDB()
    if (!db || (canWrite && !canWrite())) return
    try {
      const ns = key.slice(0, key.lastIndexOf('|'))
      const now = Date.now()
      const record: ReaderBlobRecord = {
        key,
        ns,
        data,
        mediaType,
        bytes: data.byteLength,
        savedAt: now,
        lastReadAt: now,
      }
      const tx = db.transaction([BLOB_STORE, META_STORE], 'readwrite')
      tx.objectStore(BLOB_STORE).put(record)
      tx.objectStore(META_STORE).put({
        key, store: BLOB_STORE, bytes: record.bytes, savedAt: now, lastReadAt: now,
      } satisfies ReaderBudgetRecord)
      await txDone(tx)
      cacheMutationVersion += 1
      void requestBudget(db, READER_CONTENT_BUDGET_BYTES).catch(() => {})
    } catch {
      // quota/private-mode refusals just mean "nothing cached"
    }
  },
}

/** Logout/account-switch: shared content may not survive a change of viewer. */
export async function clearReaderContentStore(): Promise<void> {
  const db = await openDB()
  if (!db) return
  try {
    const tx = db.transaction([STORE, BLOB_STORE, META_STORE], 'readwrite')
    tx.objectStore(STORE).clear()
    tx.objectStore(BLOB_STORE).clear()
    tx.objectStore(META_STORE).clear()
    await txDone(tx)
  } catch {
    // A failed clear still leaves keys account-scoped, so it cannot leak.
  }
}
