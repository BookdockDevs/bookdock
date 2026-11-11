import type {
  AnnotationRes,
  ContentFile,
  ReadingProgressRes,
  ReadingProgressUpdateReq,
} from '@bookdock/shared'

import { ApiError, apiDelete, apiPost, apiPut, apiUpload } from '@/api/client'
import { retryReadingRecords } from '@/features/reader/lib/reading-record-queue'
import { interactionRequestId } from '@/lib/interaction-request'
import { queryClient } from '@/lib/query-client'
import { withReveal } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'

import {
  remoteBookCache,
  remoteCacheScopeKey,
  type OfflineNoteOp,
  type OfflinePendingProgress,
  type RemoteBookCacheRepository,
} from './remote-book-cache'
import { useRemoteCacheStore } from './remote-cache.store'

const inFlightFlushes = new Set<string>()
let initialized = false

export function isOfflineOrNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (error instanceof ApiError) {
    return error.code === 'NETWORK_ERROR' || error.status === 0
  }
  return error instanceof TypeError || (error instanceof Error && /network|fetch|offline|load failed/i.test(error.message))
}

export function mergePendingProgress(
  serverProgress: ReadingProgressRes | null,
  pending: OfflinePendingProgress | null,
): ReadingProgressRes | null {
  if (!pending) return serverProgress
  if (serverProgress && pending.updatedAt <= serverProgress.updatedAt) return serverProgress
  return {
    id: serverProgress?.id ?? `prog-${pending.bookId}`,
    bookId: pending.bookId,
    progressRevisionId: pending.revisionId ?? serverProgress?.progressRevisionId ?? null,
    coverageRevisionId: pending.revisionId ?? serverProgress?.coverageRevisionId ?? null,
    cfi: pending.body.cfi ?? serverProgress?.cfi ?? null,
    contentCfi: pending.body.contentCfi ?? pending.body.cfi ?? serverProgress?.contentCfi ?? null,
    chapter: pending.body.chapter ?? serverProgress?.chapter ?? null,
    percent: pending.body.percent,
    fraction: pending.body.fraction ?? serverProgress?.fraction ?? pending.body.percent / 100,
    readFraction: serverProgress?.readFraction ?? 0,
    locationAvailable: true,
    coverageAvailable: serverProgress?.coverageAvailable ?? true,
    contentUpdateUnseen: serverProgress?.contentUpdateUnseen ?? false,
    updatedAt: pending.updatedAt,
  }
}

export function applyOfflineNoteOps(
  baseNotes: AnnotationRes[],
  ops: OfflineNoteOp[],
): AnnotationRes[] {
  let list = [...baseNotes]
  for (const op of ops) {
    if (op.type === 'create') {
      if (!list.some((item) => item.id === op.tempId)) {
        list.push(op.optimistic)
      }
    } else if (op.type === 'update') {
      list = list.map((item) =>
        item.id === op.noteId
          ? {
              ...item,
              ...(op.body.text !== undefined ? { text: op.body.text } : {}),
              ...(op.body.note !== undefined ? { note: op.body.note } : {}),
              ...(op.body.color !== undefined ? { color: op.body.color } : {}),
              ...(op.body.style !== undefined ? { style: op.body.style } : {}),
              updatedAt: op.updatedAt,
            }
          : item,
      )
    } else if (op.type === 'delete') {
      list = list.filter((item) => item.id !== op.noteId)
    }
  }
  return list
}

export async function flushRemoteOfflineOutbox(
  accountId: string,
  targetBookId?: string,
  repository: RemoteBookCacheRepository = remoteBookCache,
): Promise<void> {
  if (!accountId) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const scopeKey = remoteCacheScopeKey(accountId)
  if (inFlightFlushes.has(scopeKey)) return
  inFlightFlushes.add(scopeKey)

  try {
    void retryReadingRecords()
    const summary = await repository.getOutboxSummary(scopeKey)
    const bookIds = targetBookId ? (summary[targetBookId] ? [targetBookId] : []) : Object.keys(summary)
    for (const bookId of bookIds) {
      if (useAuthStore.getState().user?.id !== accountId) break

      const pendingProgress = await repository.getPendingProgress(scopeKey, bookId)
      if (pendingProgress) {
        try {
          const res = await apiPut<{ data: ReadingProgressRes | null }>(
            withReveal(`/progress/${encodeURIComponent(bookId)}`),
            pendingProgress.body,
          )
          await repository.clearPendingProgress(scopeKey, bookId, pendingProgress.updatedAt)
          await repository.updateCachedSnapshot(scopeKey, bookId, (curr) => ({
            ...curr,
            progress: res.data ?? curr.progress,
          }))
          queryClient.setQueryData(['progress', bookId, 'user'], res)
        } catch (error) {
          if (isOfflineOrNetworkError(error)) continue
          // Drop stale revision or permanent 4xx rejections instead of blocking forever.
          if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
            await repository.clearPendingProgress(scopeKey, bookId, pendingProgress.updatedAt)
          }
        }
      }

      let ops = await repository.getPendingNoteOps(scopeKey, bookId)
      if (ops.length > 0) {
        let networkBlocked = false

        while (ops.length > 0) {
          const op = ops[0]!
          try {
            if (op.type === 'create') {
              let draftId = op.body.draftId
              const uploadedImageIds: string[] = [...(op.body.imageIds ?? [])]
              if (op.pendingImageIds?.length) {
                draftId = draftId ?? interactionRequestId()
                for (const pendingId of op.pendingImageIds) {
                  const blob = await repository.getOutboxImage(scopeKey, bookId, pendingId)
                  if (!blob) continue
                  const query = new URLSearchParams({
                    domain: 'idea',
                    bookVersionId: bookId,
                    draftId,
                    kind: 'image',
                  })
                  const file = new File([blob], `${pendingId}.webp`, { type: blob.type || 'image/webp' })
                  const uploaded = await apiUpload<{ data: ContentFile }>(`/content-files?${query}`, file, 'POST')
                  uploadedImageIds.push(uploaded.data.id)
                  await repository.deleteOutboxImage(scopeKey, bookId, pendingId)
                }
              }
              const created = await apiPost<{ data: AnnotationRes }>(
                withReveal(`/annotations/book/${encodeURIComponent(bookId)}`),
                {
                  ...op.body,
                  ...(draftId ? { draftId } : {}),
                  ...(uploadedImageIds.length > 0 ? { imageIds: uploadedImageIds } : {}),
                },
              )
              if (created.data?.id) {
                ops = await repository.resolveCreatedNoteOp(scopeKey, bookId, op.opId, op.tempId, created.data)
              } else {
                ops = await repository.removeCompletedNoteOp(scopeKey, bookId, op.opId)
              }
            } else if (op.type === 'update') {
              await apiPut<{ data: AnnotationRes }>(`/annotations/${encodeURIComponent(op.noteId)}`, op.body)
              ops = await repository.removeCompletedNoteOp(scopeKey, bookId, op.opId)
            } else {
              await apiDelete(`/annotations/${encodeURIComponent(op.noteId)}`)
              ops = await repository.removeCompletedNoteOp(scopeKey, bookId, op.opId)
            }
          } catch (error) {
            if (isOfflineOrNetworkError(error)) {
              networkBlocked = true
              break
            }
            if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
              ops = await repository.removeCompletedNoteOp(scopeKey, bookId, op.opId)
              continue
            }
            networkBlocked = true
            break
          }
        }

        if (!networkBlocked && ops.length === 0) {
          void queryClient.invalidateQueries({ queryKey: ['annotations', bookId] })
          void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
          void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
        }
      }
    }
    await useRemoteCacheStore.getState().refreshPendingSync(accountId, repository)
  } finally {
    inFlightFlushes.delete(scopeKey)
  }
}

export function initRemoteOfflineSync(): () => void {
  const userId = useAuthStore.getState().user?.id ?? null
  void useRemoteCacheStore.getState().hydrate(userId)
  if (userId) void flushRemoteOfflineOutbox(userId)
  if (initialized || typeof window === 'undefined') return () => {}
  initialized = true

  const onOnlineOrVisible = () => {
    if (document.visibilityState === 'hidden') return
    const activeUserId = useAuthStore.getState().user?.id ?? null
    if (activeUserId) void flushRemoteOfflineOutbox(activeUserId)
  }

  window.addEventListener('online', onOnlineOrVisible)
  document.addEventListener('visibilitychange', onOnlineOrVisible)
  const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
    const nextId = state.user?.id ?? null
    if (nextId === (previous.user?.id ?? null)) return
    void useRemoteCacheStore.getState().hydrate(nextId)
    if (nextId) void flushRemoteOfflineOutbox(nextId)
  })

  return () => {
    initialized = false
    window.removeEventListener('online', onOnlineOrVisible)
    document.removeEventListener('visibilitychange', onOnlineOrVisible)
    unsubscribeAuth()
  }
}

export function createPendingProgressBody(body: ReadingProgressUpdateReq, bookId: string, scopeKey: string): OfflinePendingProgress {
  return {
    bookId,
    scopeKey,
    revisionId: body.revisionId ?? null,
    body,
    updatedAt: Date.now(),
  }
}
