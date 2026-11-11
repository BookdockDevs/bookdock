import { create } from 'zustand'

import type {
  AnnotationRes,
  BookDetailRes,
  BookFormat,
  Chapter,
  ReadingProgressRes,
  TextReplacementRes,
} from '@bookdock/shared'

import { apiGet, BASE_URL } from '@/api/client'
import { notify } from '@/lib/notifications'
import { withReveal } from '@/lib/reveal-hidden'

import {
  remoteBookCache,
  remoteCacheScopeKey,
  type CachedRemoteBookSummary,
  type RemoteBookCacheRepository,
} from './remote-book-cache'

export interface RemoteCacheTask {
  status: 'caching'
  progress: number
  revisionId: string | null
}

interface RemoteCacheStoreState {
  scopeKey: string
  hydrated: boolean
  cached: Record<string, CachedRemoteBookSummary>
  tasks: Record<string, RemoteCacheTask>
  pendingSync: Record<string, number>
  hydrate: (userId: string | null | undefined, repository?: RemoteBookCacheRepository) => Promise<void>
  refreshPendingSync: (userId: string | null | undefined, repository?: RemoteBookCacheRepository) => Promise<void>
  cacheBook: (
    book: { id: string; title: string; format: BookFormat; size?: number | null; revisionId?: string },
    userId: string | null | undefined,
    isGuest: boolean,
    repository?: RemoteBookCacheRepository,
  ) => Promise<boolean>
  cancelCache: (bookId: string) => void
  removeCache: (bookId: string, userId: string | null | undefined, repository?: RemoteBookCacheRepository) => Promise<void>
  markUpdatePrompted: (bookId: string, revisionId: string, userId: string | null | undefined, repository?: RemoteBookCacheRepository) => Promise<void>
}

const activeControllers = new Map<string, AbortController>()

async function downloadFileWithProgress(
  url: string,
  expectedSize: number | null | undefined,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal })
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`)
  }
  const headerLength = Number(response.headers.get('content-length') ?? '')
  const total = Number.isFinite(headerLength) && headerLength > 0
    ? headerLength
    : (typeof expectedSize === 'number' && expectedSize > 0 ? expectedSize : 0)

  if (!response.body) {
    const blob = await response.blob()
    onProgress(100)
    return blob
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (value) {
        chunks.push(value)
        received += value.byteLength
        if (total > 0) {
          onProgress(Math.min(95, Math.max(10, Math.round(10 + (received / total) * 85))))
        }
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
  onProgress(98)
  return new Blob(chunks as BlobPart[], { type: 'application/epub+zip' })
}

export const useRemoteCacheStore = create<RemoteCacheStoreState>((set, get) => ({
  scopeKey: 'guest',
  hydrated: false,
  cached: {},
  tasks: {},
  pendingSync: {},

  async hydrate(userId, repository = remoteBookCache) {
    const scopeKey = remoteCacheScopeKey(userId)
    try {
      const [summaries, pendingSync] = await Promise.all([
        repository.listSummaries(scopeKey),
        repository.getOutboxSummary(scopeKey),
      ])
      const cached: Record<string, CachedRemoteBookSummary> = {}
      for (const item of summaries) cached[item.bookId] = item
      set({ scopeKey, hydrated: true, cached, pendingSync })
    } catch {
      set({ scopeKey, hydrated: true, cached: {}, pendingSync: {} })
    }
  },

  async refreshPendingSync(userId, repository = remoteBookCache) {
    const scopeKey = remoteCacheScopeKey(userId)
    if (get().scopeKey !== scopeKey) return
    try {
      const pendingSync = await repository.getOutboxSummary(scopeKey)
      if (get().scopeKey === scopeKey) set({ pendingSync })
    } catch { /* ignore */ }
  },

  cancelCache(bookId) {
    activeControllers.get(bookId)?.abort()
    activeControllers.delete(bookId)
    set((state) => {
      const tasks = { ...state.tasks }
      delete tasks[bookId]
      return { tasks }
    })
  },

  async cacheBook(book, userId, isGuest, repository = remoteBookCache) {
    if (activeControllers.has(book.id)) return false
    const scopeKey = remoteCacheScopeKey(userId)
    const controller = new AbortController()
    activeControllers.set(book.id, controller)
    set((state) => ({
      tasks: {
        ...state.tasks,
        [book.id]: { status: 'caching', progress: 5, revisionId: book.revisionId ?? null },
      },
    }))

    const updateProgress = (progress: number) => {
      set((state) => {
        const current = state.tasks[book.id]
        if (!current) return state
        return { tasks: { ...state.tasks, [book.id]: { ...current, progress } } }
      })
    }

    try {
      const detailRes = await apiGet<{ data: BookDetailRes }>(withReveal(`/books/${encodeURIComponent(book.id)}`))
      controller.signal.throwIfAborted()
      const detail = detailRes.data
      const revisionId = detail.revisionId ?? book.revisionId ?? ''
      updateProgress(8)

      const [chaptersRes, progressRes, notesRes, replacementsRes, coverBlob] = await Promise.all([
        apiGet<{ data: Chapter[] }>(withReveal(`/books/${encodeURIComponent(book.id)}/chapters`))
          .then((res) => res.data)
          .catch(() => [] as Chapter[]),
        isGuest
          ? Promise.resolve(null)
          : apiGet<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${encodeURIComponent(book.id)}`))
              .then((res) => res.data)
              .catch(() => null),
        isGuest
          ? Promise.resolve([] as AnnotationRes[])
          : apiGet<{ data: AnnotationRes[] }>(withReveal(`/annotations/book/${encodeURIComponent(book.id)}`))
              .then((res) => res.data)
              .catch(() => [] as AnnotationRes[]),
        isGuest
          ? Promise.resolve([] as TextReplacementRes[])
          : apiGet<{ data: TextReplacementRes[] }>(`/replacements?bookId=${encodeURIComponent(book.id)}`)
              .then((res) => res.data)
              .catch(() => [] as TextReplacementRes[]),
        detail.coverKey
          ? fetch(`${BASE_URL}${withReveal(`/books/${encodeURIComponent(book.id)}/cover`)}`, {
              credentials: 'same-origin',
              signal: controller.signal,
            }).then((res) => (res.ok ? res.blob() : null)).catch(() => null)
          : Promise.resolve(null),
      ])
      controller.signal.throwIfAborted()
      updateProgress(10)

      const contentUrl = `${BASE_URL}${withReveal(`/books/${encodeURIComponent(book.id)}/file?reader=1&revisionId=${encodeURIComponent(revisionId)}&v=${detail.updatedAt}`)}`
      const fileBlob = await downloadFileWithProgress(contentUrl, detail.size ?? book.size, controller.signal, updateProgress)
      controller.signal.throwIfAborted()

      const now = Date.now()
      const record = {
        bookId: book.id,
        scopeKey,
        revisionId,
        contentUpdatedAt: detail.updatedAt,
        format: detail.format,
        title: detail.title,
        size: fileBlob.size || detail.size || 0,
        cachedAt: now,
        updatedAt: now,
        promptedUpdateRevisionId: null,
        detail,
        chapters: chaptersRes,
        progress: progressRes,
        notes: notesRes,
        replacements: replacementsRes,
      }
      await repository.saveBook(record, fileBlob, coverBlob)

      set((state) => {
        const tasks = { ...state.tasks }
        delete tasks[book.id]
        const summary: CachedRemoteBookSummary = {
          bookId: record.bookId,
          scopeKey: record.scopeKey,
          revisionId: record.revisionId,
          contentUpdatedAt: record.contentUpdatedAt,
          cachedAt: record.cachedAt,
          size: record.size,
          promptedUpdateRevisionId: record.promptedUpdateRevisionId,
          title: record.title,
        }
        return {
          tasks,
          ...(state.scopeKey === scopeKey ? { cached: { ...state.cached, [book.id]: summary } } : {}),
        }
      })
      notify.success({ key: 'library.cacheSuccess', params: { title: detail.title } })
      return true
    } catch (error) {
      set((state) => {
        const tasks = { ...state.tasks }
        delete tasks[book.id]
        return { tasks }
      })
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        notify.error({ key: 'library.cacheFailed' })
      }
      return false
    } finally {
      activeControllers.delete(book.id)
    }
  },

  async removeCache(bookId, userId, repository = remoteBookCache) {
    const scopeKey = remoteCacheScopeKey(userId)
    await repository.removeBook(scopeKey, bookId)
    set((state) => {
      if (state.scopeKey !== scopeKey) return state
      const cached = { ...state.cached }
      delete cached[bookId]
      return { cached }
    })
    notify.info({ key: 'library.cacheCleared' })
  },

  async markUpdatePrompted(bookId, revisionId, userId, repository = remoteBookCache) {
    const scopeKey = remoteCacheScopeKey(userId)
    await repository.markUpdatePrompted(scopeKey, bookId, revisionId)
    set((state) => {
      const item = state.cached[bookId]
      if (state.scopeKey !== scopeKey || !item) return state
      return {
        cached: {
          ...state.cached,
          [bookId]: { ...item, promptedUpdateRevisionId: revisionId },
        },
      }
    })
  },
}))
