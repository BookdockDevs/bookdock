import type { BookFormat, ClientBookRef } from '@bookdock/shared'
import { useQueryClient } from '@tanstack/react-query'

import { isDeviceBook } from '@/features/reading-data/book-source'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import type { CachedRemoteBookSummary } from './remote-book-cache'
import { useRemoteCacheStore, type RemoteCacheTask } from './remote-cache.store'

export type RemoteCacheActionStatus = 'uncached' | 'caching' | 'cached' | 'update-available'

export interface RemoteCacheTarget {
  id: string
  ref?: ClientBookRef
  title: string
  format: BookFormat
  size?: number | null
  deletedAt?: number | null
  sourceUnavailable?: boolean
  revisionId?: string
}

export function resolveRemoteCacheStatus(input: {
  cached?: CachedRemoteBookSummary
  task?: RemoteCacheTask
  remoteRevisionId?: string | null
}): RemoteCacheActionStatus {
  if (input.task?.status === 'caching') return 'caching'
  if (!input.cached) return 'uncached'
  if (input.remoteRevisionId && input.cached.revisionId !== input.remoteRevisionId) {
    return 'update-available'
  }
  if (
    input.cached.promptedUpdateRevisionId
    && input.cached.promptedUpdateRevisionId !== input.cached.revisionId
  ) {
    return 'update-available'
  }
  return 'cached'
}

export function getRemoteCacheLabelKey(status: RemoteCacheActionStatus): string {
  switch (status) {
    case 'caching':
      return 'library.cachingBook'
    case 'cached':
      return 'library.clearBookCache'
    case 'update-available':
      return 'library.updateBookCache'
    case 'uncached':
    default:
      return 'library.cacheBook'
  }
}

export function useRemoteBookCacheAction(book: RemoteCacheTarget) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const cached = useRemoteCacheStore((state) => state.cached[book.id])
  const task = useRemoteCacheStore((state) => state.tasks[book.id])
  const pendingSyncCount = useRemoteCacheStore((state) => state.pendingSync[book.id] ?? 0)
  const cacheBook = useRemoteCacheStore((state) => state.cacheBook)
  const cancelCache = useRemoteCacheStore((state) => state.cancelCache)
  const removeCache = useRemoteCacheStore((state) => state.removeCache)

  const eligible = Boolean(!isDeviceBook(book.ref) && !book.deletedAt && !book.sourceUnavailable && typeof indexedDB !== 'undefined')
  const cachedQueryDetail = queryClient.getQueryData<{ data?: { revisionId?: string } }>(['book', book.id])
  const remoteRevisionId = book.revisionId ?? cachedQueryDetail?.data?.revisionId ?? null
  const status = resolveRemoteCacheStatus({ cached, task, remoteRevisionId })
  const progress = task?.progress ?? 0
  const isGuest = !user || user.role === 'guest'
  const userId = isGuest ? null : user.id

  function trigger() {
    if (!eligible) return
    if (status === 'caching') {
      cancelCache(book.id)
      return
    }
    if (status === 'cached') {
      void removeCache(book.id, userId)
      return
    }
    void cacheBook(book, userId, isGuest)
  }

  function clearCache() {
    if (!eligible || status === 'caching') return
    void removeCache(book.id, userId)
  }

  return {
    eligible,
    status,
    progress,
    label: _(getRemoteCacheLabelKey(status)),
    clearLabel: _('library.clearBookCache'),
    pendingSyncCount,
    trigger,
    clearCache,
  }
}
