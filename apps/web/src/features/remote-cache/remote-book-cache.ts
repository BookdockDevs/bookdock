import type {
  AnnotationCreateReq,
  AnnotationRes,
  AnnotationUpdateReq,
  BookDetailRes,
  BookFormat,
  Chapter,
  ReadingProgressRes,
  ReadingProgressUpdateReq,
  TextReplacementRes,
} from '@bookdock/shared'

const DB_NAME = 'bookdock-remote-book-cache'
const DB_VERSION = 1
const STORES = ['books', 'files', 'outbox'] as const
type StoreName = typeof STORES[number]

export interface CachedRemoteBookRecord {
  bookId: string
  scopeKey: string
  revisionId: string
  contentUpdatedAt: number | null
  format: BookFormat
  title: string
  size: number
  cachedAt: number
  updatedAt: number
  promptedUpdateRevisionId: string | null
  detail: BookDetailRes
  chapters: Chapter[]
  progress: ReadingProgressRes | null
  notes: AnnotationRes[]
  replacements: TextReplacementRes[]
}

export interface CachedRemoteBookSummary {
  bookId: string
  scopeKey: string
  revisionId: string
  contentUpdatedAt: number | null
  cachedAt: number
  size: number
  promptedUpdateRevisionId: string | null
  title: string
}

export interface OfflinePendingProgress {
  bookId: string
  scopeKey: string
  revisionId: string | null
  body: ReadingProgressUpdateReq
  updatedAt: number
}

export type OfflineNoteOp =
  | {
      opId: string
      type: 'create'
      tempId: string
      body: AnnotationCreateReq
      pendingImageIds?: string[]
      optimistic: AnnotationRes
      createdAt: number
    }
  | {
      opId: string
      type: 'update'
      noteId: string
      body: AnnotationUpdateReq
      updatedAt: number
    }
  | {
      opId: string
      type: 'delete'
      noteId: string
      deletedAt: number
    }

export function remoteCacheScopeKey(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : 'guest'
}

function bookKey(scopeKey: string, bookId: string): string {
  return JSON.stringify([scopeKey, bookId])
}

function fileKey(scopeKey: string, bookId: string): string {
  return `file:${bookKey(scopeKey, bookId)}`
}

function coverKey(scopeKey: string, bookId: string): string {
  return `cover:${bookKey(scopeKey, bookId)}`
}

function progressOutboxKey(scopeKey: string, bookId: string): string {
  return `progress:${bookKey(scopeKey, bookId)}`
}

function notesOutboxKey(scopeKey: string, bookId: string): string {
  return `notes:${bookKey(scopeKey, bookId)}`
}

function outboxImageKey(scopeKey: string, bookId: string, imageId: string): string {
  return `outbox-image:${JSON.stringify([scopeKey, bookId, imageId])}`
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class RemoteBookCacheRepository {
  private opening?: Promise<IDBDatabase>
  constructor(private databaseName = DB_NAME) {}

  private database(): Promise<IDBDatabase> {
    this.opening ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'))
        return
      }
      const open = indexedDB.open(this.databaseName, DB_VERSION)
      open.onupgradeneeded = () => {
        for (const store of STORES) {
          if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store)
        }
      }
      open.onsuccess = () => {
        open.result.onversionchange = () => {
          open.result.close()
          this.opening = undefined
        }
        resolve(open.result)
      }
      open.onerror = () => {
        this.opening = undefined
        reject(open.error)
      }
    })
    return this.opening
  }

  private async transaction<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.database()
    const tx = db.transaction(stores, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('Cache transaction aborted'))
      tx.onerror = () => {}
    })
    void done.catch(() => {})
    try {
      const result = await fn(tx)
      await done
      return result
    } catch (error) {
      try { tx.abort() } catch { /* already settled */ }
      await done.catch(() => {})
      throw error
    }
  }

  async listSummaries(scopeKey: string): Promise<CachedRemoteBookSummary[]> {
    return this.transaction(['books'], 'readonly', async (tx) => {
      const rows = await request<CachedRemoteBookRecord[]>(tx.objectStore('books').getAll())
      return rows
        .filter((row) => row.scopeKey === scopeKey)
        .map((row) => ({
          bookId: row.bookId,
          scopeKey: row.scopeKey,
          revisionId: row.revisionId,
          contentUpdatedAt: row.contentUpdatedAt,
          cachedAt: row.cachedAt,
          size: row.size,
          promptedUpdateRevisionId: row.promptedUpdateRevisionId,
          title: row.title,
        }))
    })
  }

  async getBookRecord(scopeKey: string, bookId: string): Promise<CachedRemoteBookRecord | null> {
    return this.transaction(['books'], 'readonly', async (tx) => {
      return await request<CachedRemoteBookRecord | undefined>(tx.objectStore('books').get(bookKey(scopeKey, bookId))) ?? null
    })
  }

  async getBook(scopeKey: string, bookId: string): Promise<{ record: CachedRemoteBookRecord; file: Blob; cover: Blob | null } | null> {
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const record = await request<CachedRemoteBookRecord | undefined>(tx.objectStore('books').get(bookKey(scopeKey, bookId)))
      if (!record) return null
      const file = await request<Blob | undefined>(tx.objectStore('files').get(fileKey(scopeKey, bookId)))
      if (!file) return null
      const cover = await request<Blob | undefined>(tx.objectStore('files').get(coverKey(scopeKey, bookId))) ?? null
      return { record, file, cover }
    })
  }

  async saveBook(record: CachedRemoteBookRecord, file: Blob, cover: Blob | null): Promise<void> {
    await this.transaction(['books', 'files'], 'readwrite', async (tx) => {
      const key = bookKey(record.scopeKey, record.bookId)
      await request(tx.objectStore('books').put(record, key))
      await request(tx.objectStore('files').put(file, fileKey(record.scopeKey, record.bookId)))
      if (cover) await request(tx.objectStore('files').put(cover, coverKey(record.scopeKey, record.bookId)))
      else await request(tx.objectStore('files').delete(coverKey(record.scopeKey, record.bookId)))
    })
  }

  async removeBook(scopeKey: string, bookId: string): Promise<void> {
    await this.transaction(['books', 'files'], 'readwrite', async (tx) => {
      await request(tx.objectStore('books').delete(bookKey(scopeKey, bookId)))
      await request(tx.objectStore('files').delete(fileKey(scopeKey, bookId)))
      await request(tx.objectStore('files').delete(coverKey(scopeKey, bookId)))
    })
  }

  async markUpdatePrompted(scopeKey: string, bookId: string, revisionId: string): Promise<void> {
    await this.transaction(['books'], 'readwrite', async (tx) => {
      const store = tx.objectStore('books')
      const key = bookKey(scopeKey, bookId)
      const current = await request<CachedRemoteBookRecord | undefined>(store.get(key))
      if (!current || current.promptedUpdateRevisionId === revisionId) return
      await request(store.put({ ...current, promptedUpdateRevisionId: revisionId }, key))
    })
  }

  async updateCachedSnapshot(
    scopeKey: string,
    bookId: string,
    updater: (current: CachedRemoteBookRecord) => CachedRemoteBookRecord,
  ): Promise<void> {
    await this.transaction(['books'], 'readwrite', async (tx) => {
      const store = tx.objectStore('books')
      const key = bookKey(scopeKey, bookId)
      const current = await request<CachedRemoteBookRecord | undefined>(store.get(key))
      if (!current) return
      await request(store.put(updater(current), key))
    })
  }

  async savePendingProgress(entry: OfflinePendingProgress): Promise<void> {
    await this.transaction(['outbox'], 'readwrite', async (tx) => {
      await request(tx.objectStore('outbox').put(entry, progressOutboxKey(entry.scopeKey, entry.bookId)))
    })
  }

  async getPendingProgress(scopeKey: string, bookId: string): Promise<OfflinePendingProgress | null> {
    return this.transaction(['outbox'], 'readonly', async (tx) => {
      return await request<OfflinePendingProgress | undefined>(tx.objectStore('outbox').get(progressOutboxKey(scopeKey, bookId))) ?? null
    })
  }

  async clearPendingProgress(scopeKey: string, bookId: string, expectedUpdatedAt: number): Promise<void> {
    await this.transaction(['outbox'], 'readwrite', async (tx) => {
      const store = tx.objectStore('outbox')
      const key = progressOutboxKey(scopeKey, bookId)
      const current = await request<OfflinePendingProgress | undefined>(store.get(key))
      if (current && current.updatedAt <= expectedUpdatedAt) {
        await request(store.delete(key))
      }
    })
  }

  async stageOutboxImage(scopeKey: string, bookId: string, imageId: string, file: Blob): Promise<void> {
    await this.transaction(['files'], 'readwrite', async (tx) => {
      await request(tx.objectStore('files').put(file, outboxImageKey(scopeKey, bookId, imageId)))
    })
  }

  async getOutboxImage(scopeKey: string, bookId: string, imageId: string): Promise<Blob | null> {
    return this.transaction(['files'], 'readonly', async (tx) => {
      return await request<Blob | undefined>(tx.objectStore('files').get(outboxImageKey(scopeKey, bookId, imageId))) ?? null
    })
  }

  async deleteOutboxImage(scopeKey: string, bookId: string, imageId: string): Promise<void> {
    await this.transaction(['files'], 'readwrite', async (tx) => {
      await request(tx.objectStore('files').delete(outboxImageKey(scopeKey, bookId, imageId)))
    })
  }

  async getPendingNoteOps(scopeKey: string, bookId: string): Promise<OfflineNoteOp[]> {
    return this.transaction(['outbox'], 'readonly', async (tx) => {
      return await request<OfflineNoteOp[] | undefined>(tx.objectStore('outbox').get(notesOutboxKey(scopeKey, bookId))) ?? []
    })
  }

  async replacePendingNoteOps(scopeKey: string, bookId: string, ops: OfflineNoteOp[]): Promise<void> {
    await this.transaction(['outbox'], 'readwrite', async (tx) => {
      const store = tx.objectStore('outbox')
      const key = notesOutboxKey(scopeKey, bookId)
      if (ops.length === 0) await request(store.delete(key))
      else await request(store.put(ops, key))
    })
  }

  async resolveCreatedNoteOp(
    scopeKey: string,
    bookId: string,
    opId: string,
    tempId: string,
    created: AnnotationRes,
  ): Promise<OfflineNoteOp[]> {
    return this.transaction(['outbox', 'books'], 'readwrite', async (tx) => {
      const outbox = tx.objectStore('outbox')
      const key = notesOutboxKey(scopeKey, bookId)
      const current = await request<OfflineNoteOp[] | undefined>(outbox.get(key)) ?? []
      const next: OfflineNoteOp[] = []
      for (const op of current) {
        if (op.opId === opId) continue
        if (op.type === 'update' && op.noteId === tempId) {
          next.push({ ...op, noteId: created.id })
        } else if (op.type === 'delete' && op.noteId === tempId) {
          next.push({ ...op, noteId: created.id })
        } else {
          next.push(op)
        }
      }
      if (next.length === 0) await request(outbox.delete(key))
      else await request(outbox.put(next, key))

      const books = tx.objectStore('books')
      const bKey = bookKey(scopeKey, bookId)
      const snapshot = await request<CachedRemoteBookRecord | undefined>(books.get(bKey))
      if (snapshot) {
        const replaced = snapshot.notes.some((n) => n.id === tempId)
          ? snapshot.notes.map((n) => (n.id === tempId ? created : n))
          : [...snapshot.notes, created]
        await request(books.put({ ...snapshot, notes: replaced }, bKey))
      }
      return next
    })
  }

  async removeCompletedNoteOp(scopeKey: string, bookId: string, opId: string): Promise<OfflineNoteOp[]> {
    return this.transaction(['outbox'], 'readwrite', async (tx) => {
      const store = tx.objectStore('outbox')
      const key = notesOutboxKey(scopeKey, bookId)
      const current = await request<OfflineNoteOp[] | undefined>(store.get(key)) ?? []
      const next = current.filter((op) => op.opId !== opId)
      if (next.length === 0) await request(store.delete(key))
      else await request(store.put(next, key))
      return next
    })
  }

  async enqueueNoteOp(scopeKey: string, bookId: string, op: OfflineNoteOp): Promise<OfflineNoteOp[]> {
    return this.transaction(['outbox', 'files'], 'readwrite', async (tx) => {
      const outbox = tx.objectStore('outbox')
      const files = tx.objectStore('files')
      const key = notesOutboxKey(scopeKey, bookId)
      const current = [...(await request<OfflineNoteOp[] | undefined>(outbox.get(key)) ?? [])]
      const imagesToDelete: string[] = []

      if (op.type === 'update') {
        const createIdx = current.findIndex((item) => item.type === 'create' && item.tempId === op.noteId)
        if (createIdx >= 0) {
          const prev = current[createIdx]!
          if (prev.type === 'create') {
            current[createIdx] = {
              ...prev,
              body: {
                ...prev.body,
                ...(op.body.text !== undefined ? { text: op.body.text } : {}),
                ...(op.body.note !== undefined ? { note: op.body.note } : {}),
                ...(op.body.color !== undefined ? { color: op.body.color } : {}),
                ...(op.body.style !== undefined ? { style: op.body.style } : {}),
                ...(op.body.imageIds !== undefined ? { imageIds: op.body.imageIds } : {}),
              },
              optimistic: {
                ...prev.optimistic,
                ...(op.body.text !== undefined ? { text: op.body.text } : {}),
                ...(op.body.note !== undefined ? { note: op.body.note } : {}),
                ...(op.body.color !== undefined ? { color: op.body.color } : {}),
                ...(op.body.style !== undefined ? { style: op.body.style } : {}),
                updatedAt: op.updatedAt,
              },
            }
          }
        } else {
          const updateIdx = current.findIndex((item) => item.type === 'update' && item.noteId === op.noteId)
          if (updateIdx >= 0) {
            const prev = current[updateIdx]!
            if (prev.type === 'update') {
              current[updateIdx] = { ...op, body: { ...prev.body, ...op.body } }
            }
          } else {
            current.push(op)
          }
        }
      } else if (op.type === 'delete') {
        const createIdx = current.findIndex((item) => item.type === 'create' && item.tempId === op.noteId)
        if (createIdx >= 0) {
          const [removed] = current.splice(createIdx, 1)
          if (removed?.type === 'create' && removed.pendingImageIds?.length) {
            imagesToDelete.push(...removed.pendingImageIds)
          }
        } else {
          for (let i = current.length - 1; i >= 0; i--) {
            const item = current[i]!
            if (item.type === 'update' && item.noteId === op.noteId) current.splice(i, 1)
          }
          if (!current.some((item) => item.type === 'delete' && item.noteId === op.noteId)) {
            current.push(op)
          }
        }
      } else {
        current.push(op)
      }

      for (const imageId of imagesToDelete) {
        await request(files.delete(outboxImageKey(scopeKey, bookId, imageId)))
      }
      if (current.length === 0) await request(outbox.delete(key))
      else await request(outbox.put(current, key))
      return current
    })
  }

  async getOutboxSummary(scopeKey: string): Promise<Record<string, number>> {
    return this.transaction(['outbox'], 'readonly', async (tx) => {
      const store = tx.objectStore('outbox')
      const keys = await request<IDBValidKey[]>(store.getAllKeys())
      const counts: Record<string, number> = {}
      for (const rawKey of keys) {
        if (typeof rawKey !== 'string') continue
        const isProgress = rawKey.startsWith('progress:')
        const isNotes = rawKey.startsWith('notes:')
        if (!isProgress && !isNotes) continue
        const parsed = JSON.parse(rawKey.slice(rawKey.indexOf(':') + 1)) as [string, string]
        if (parsed[0] !== scopeKey) continue
        const bookId = parsed[1]
        const value = await request<unknown>(store.get(rawKey))
        if (isProgress && value) counts[bookId] = (counts[bookId] ?? 0) + 1
        if (isNotes && Array.isArray(value)) counts[bookId] = (counts[bookId] ?? 0) + value.length
      }
      return counts
    })
  }

  async close(): Promise<void> {
    const db = await this.opening?.catch(() => undefined)
    db?.close()
    this.opening = undefined
  }
}

export const remoteBookCache = new RemoteBookCacheRepository()
