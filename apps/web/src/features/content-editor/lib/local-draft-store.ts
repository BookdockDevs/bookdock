import { CONTENT_EDITOR_MAX_REQUEST_BYTES } from '@bookdock/shared'

export interface LocalDraftRecord {
  version: 1
  key: string
  revisionId: string
  token: string
  savedAt: number
  payload: unknown
}

const DB_NAME = 'bookdock-editor-drafts'
const STORE = 'drafts'
export const DRAFT_MAX_AGE = 90 * 24 * 60 * 60 * 1000

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(DB_NAME, 1) } catch (error) { reject(error); return }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('accountId', 'accountId')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Local draft database is blocked'))
  })
}

export function draftKey(accountId: string, bookId: string, format: 'txt' | 'epub', target?: { libraryId: string; libraryBookId: string; versionLinkId: string }): string {
  return JSON.stringify([accountId, format, bookId, target ? [target.libraryId, target.libraryBookId, target.versionLinkId] : null])
}

export async function readLocalDraft(key: string): Promise<unknown> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onabort = () => { db.close(); reject(tx.error) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// Compare and write in one transaction so other tabs cannot overwrite an unseen record.
export async function replaceLocalDraft(key: string, expectedToken: string | null, record: LocalDraftRecord | null, canWrite: () => boolean): Promise<boolean> {
  if (record && new Blob([JSON.stringify(record)]).size > CONTENT_EDITOR_MAX_REQUEST_BYTES) throw new Error('Local draft is too large')
  const db = await openDatabase()
  if (!canWrite()) { db.close(); return false }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const request = store.get(key)
    const accountId = JSON.parse(key)[0] as string
    let matched = false
    request.onsuccess = () => {
      const current = request.result as LocalDraftRecord | undefined
      if (!canWrite() || (current?.token ?? null) !== expectedToken) return
      if (record && !current) {
        const count = store.index('accountId').count(accountId)
        count.onsuccess = () => {
          if (!canWrite()) return
          if (count.result >= 8) { tx.abort(); return }
          matched = true; store.put({ ...record, accountId })
        }
      } else {
        matched = true
        if (record) store.put({ ...record, accountId })
        else store.delete(key)
      }
    }
    tx.oncomplete = () => { db.close(); resolve(matched) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local draft transaction aborted')) }
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local draft transaction failed')) }
  })
}
