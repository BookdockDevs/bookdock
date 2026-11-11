import type { BookDetailRes, ReaderBookSettings, ReadingProgressRes, ReadingProgressUpdateReq, ViewSettings } from '@bookdock/shared'
import { apiGet, apiPatch, apiPut } from '@/api/client'
import { notify } from '@/lib/notifications'
import { withReveal } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'
import { remoteBookCache, remoteCacheScopeKey } from '@/features/remote-cache/remote-book-cache'
import { useRemoteCacheStore } from '@/features/remote-cache/remote-cache.store'
import { createPendingProgressBody, flushRemoteOfflineOutbox, isOfflineOrNetworkError, mergePendingProgress } from '@/features/remote-cache/offline-sync'
import { getGuestProgress, saveGuestProgress } from '../reader/lib/guest-progress'

export function remoteReaderSession(bookId: string, guest: boolean) {
  const base = `/books/${encodeURIComponent(bookId)}`
  const currentUserId = () => (guest ? null : useAuthStore.getState().user?.id ?? null)
  const scopeKey = () => remoteCacheScopeKey(currentUserId())

  return {
    getBook: async () => {
      const userId = currentUserId()
      const scope = remoteCacheScopeKey(userId)
      try {
        const res = await apiGet<{ data: BookDetailRes }>(withReveal(base))
        const cached = await remoteBookCache.getBookRecord(scope, bookId).catch(() => null)
        if (cached) {
          const remoteRev = res.data.revisionId ?? ''
          if (remoteRev && cached.revisionId === remoteRev) {
            void remoteBookCache.updateCachedSnapshot(scope, bookId, (curr) => ({ ...curr, detail: res.data })).catch(() => {})
          } else if (remoteRev && cached.revisionId !== remoteRev && cached.promptedUpdateRevisionId !== remoteRev) {
            notify.info({ key: 'reader.cachedBookUpdateAvailable' }, { dedupeKey: `cached-update:${bookId}:${remoteRev}` })
            void useRemoteCacheStore.getState().markUpdatePrompted(bookId, remoteRev, userId).catch(() => {})
          }
        }
        return res
      } catch (error) {
        if (!isOfflineOrNetworkError(error)) throw error
        const cached = await remoteBookCache.getBookRecord(scope, bookId).catch(() => null)
        if (!cached) throw error
        return { data: cached.detail }
      }
    },
    getProgress: async () => {
      if (guest) return { data: getGuestProgress(bookId) }
      const userId = currentUserId()
      const scope = remoteCacheScopeKey(userId)
      const pending = await remoteBookCache.getPendingProgress(scope, bookId).catch(() => null)
      try {
        const res = await apiGet<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${encodeURIComponent(bookId)}`))
        const merged = mergePendingProgress(res.data, pending)
        if (pending && userId) void flushRemoteOfflineOutbox(userId, bookId)
        else void remoteBookCache.updateCachedSnapshot(scope, bookId, (curr) => ({ ...curr, progress: res.data })).catch(() => {})
        return { data: merged }
      } catch (error) {
        if (!isOfflineOrNetworkError(error)) throw error
        const cached = await remoteBookCache.getBookRecord(scope, bookId).catch(() => null)
        if (!cached && !pending) throw error
        return { data: mergePendingProgress(cached?.progress ?? null, pending) }
      }
    },
    saveProgress: async (body: ReadingProgressUpdateReq) => {
      if (guest) return { data: saveGuestProgress(bookId, body) }
      const userId = currentUserId()
      const scope = scopeKey()
      const pending = createPendingProgressBody(body, bookId, scope)
      const persistOffline = async () => {
        await remoteBookCache.savePendingProgress(pending)
        const cached = await remoteBookCache.getBookRecord(scope, bookId).catch(() => null)
        const optimistic = mergePendingProgress(cached?.progress ?? null, pending)
        await remoteBookCache.updateCachedSnapshot(scope, bookId, (curr) => ({ ...curr, progress: optimistic })).catch(() => {})
        await useRemoteCacheStore.getState().refreshPendingSync(userId)
        return { data: optimistic }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return persistOffline()
      }
      try {
        const res = await apiPut<{ data: ReadingProgressRes | null }>(withReveal(`/progress/${encodeURIComponent(bookId)}`), body)
        await remoteBookCache.clearPendingProgress(scope, bookId, pending.updatedAt).catch(() => {})
        void remoteBookCache.updateCachedSnapshot(scope, bookId, (curr) => ({ ...curr, progress: res.data })).catch(() => {})
        return res
      } catch (error) {
        if (!isOfflineOrNetworkError(error)) throw error
        return persistOffline()
      }
    },
    saveSettings: (viewSettings: ViewSettings | null) => apiPatch<{ data: ReaderBookSettings }>(withReveal(`${base}/reader-settings`), { viewSettings }),
    bindPreset: (boundPresetId: string | null) => apiPatch<{ data: ReaderBookSettings }>(withReveal(`${base}/reader-settings`), { boundPresetId }),
    contentUrl: (book: Pick<BookDetailRes, 'revisionId' | 'updatedAt'>) => withReveal(`/api/v1/books/${encodeURIComponent(bookId)}/file?reader=1&revisionId=${encodeURIComponent(book.revisionId ?? '')}&v=${book.updatedAt}`),
  }
}
