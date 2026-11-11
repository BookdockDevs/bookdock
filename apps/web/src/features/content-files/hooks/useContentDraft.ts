import { useEffect, useMemo, useRef, useState } from 'react'

import { useMutation } from '@tanstack/react-query'

import { clientBookKey } from '@bookdock/shared'
import type { ContentFile, ContentFileUpload } from '@bookdock/shared'

import { apiDelete, apiUpload } from '@/api/client'
import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { localLibraryRepository } from '@/features/local-library/repository'
import { remoteBookCache, remoteCacheScopeKey } from '@/features/remote-cache/remote-book-cache'
import { useRemoteCacheStore } from '@/features/remote-cache/remote-cache.store'
import { isOfflineOrNetworkError } from '@/features/remote-cache/offline-sync'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'
import { interactionRequestId } from '@/lib/interaction-request'

export interface ContentUploadEntry {
  id: string
  file: File
  kind: ContentFileUpload['kind']
  progress: number
  status: 'uploading' | 'ready' | 'failed'
  resource?: ContentFile
}

export function useContentDraft(context: Omit<ContentFileUpload, 'draftId' | 'kind' | 'bookVersionId'> & { bookVersionId?: string }, onUploaded: (file: ContentFile) => void) {
  const local = useLocalReader()
  const account = useAuthStore((state) => state.user)
  const epoch = getAuthSessionRevision()
  const ownerKey = local ? JSON.stringify(clientBookKey(local.ref)) : JSON.stringify([account?.id ?? null, epoch, context.domain, context.bookVersionId, context.targetId])
  const owner = useRef(ownerKey)
  owner.current = ownerKey
  const { draftId } = useMemo(() => ({ ownerKey, draftId: interactionRequestId() }), [ownerKey])
  const [entryState, setEntryState] = useState<{ ownerKey: string; entries: ContentUploadEntry[] }>({ ownerKey, entries: [] })
  const entries = entryState.ownerKey === ownerKey ? entryState.entries : []
  const setEntries = (update: ContentUploadEntry[] | ((rows: ContentUploadEntry[]) => ContentUploadEntry[])) => setEntryState((previous) => {
    if (owner.current !== ownerKey) return previous
    const rows = previous.ownerKey === ownerKey ? previous.entries : []
    return { ownerKey, entries: typeof update === 'function' ? update(rows) : update }
  })
  const controllers = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)
  const touched = useRef(false)
  useEffect(() => {
    mounted.current = true
    const pending = controllers.current
    return () => {
      mounted.current = false
      for (const controller of pending.values()) controller.abort()
      pending.clear()
      // StrictMode immediately recreates mount effects. Cancel only a real
      // unmount; the server preserves publication when this races with save.
      queueMicrotask(() => {
        if ((!mounted.current || owner.current !== ownerKey) && touched.current) void (local ? localLibraryRepository.cancelNoteImages(local.ref, draftId) : apiDelete(`/content-files/drafts/${draftId}`)).catch(() => {})
      })
    }
  }, [draftId, local, ownerKey])

  const isCachedRemote = useRemoteCacheStore((state) => Boolean(!local && context.bookVersionId && state.cached[context.bookVersionId]))
  const upload = useMutation({
    networkMode: local || isCachedRemote ? 'always' : 'online',
    mutationFn: async (entry: ContentUploadEntry) => {
      if (!mounted.current || owner.current !== ownerKey || !local && getAuthSessionRevision() !== epoch) throw new DOMException('Content draft owner changed', 'AbortError')
      const controller = new AbortController()
      controllers.current.set(entry.id, controller)
      if (!local && !context.bookVersionId) throw new Error('Content upload requires an authorized book')
      const query = new URLSearchParams({ domain: context.domain, bookVersionId: context.bookVersionId ?? '', draftId, kind: entry.kind })
      if (context.targetId) query.set('targetId', context.targetId)
      const stageOfflineImage = async (): Promise<{ data: ContentFile }> => {
        if (context.domain !== 'idea' || entry.kind !== 'image' || !account || !context.bookVersionId) {
          throw new Error('Offline attachment staging is only supported for cached idea images')
        }
        const pendingId = `pending-image_${interactionRequestId()}`
        await remoteBookCache.stageOutboxImage(remoteCacheScopeKey(account.id), context.bookVersionId, pendingId, entry.file)
        return {
          data: {
            id: pendingId,
            kind: 'image',
            name: entry.file.name,
            mimeType: entry.file.type || 'image/webp',
            size: entry.file.size,
            url: '',
            localSource: {
              book: { scope: { kind: 'remote', connectionId: 'default', accountId: account.id }, bookId: context.bookVersionId },
              id: pendingId,
            },
          },
        }
      }
      try {
        const result = local ? await (async () => {
          if (context.domain !== 'idea' || entry.kind !== 'image') throw new Error('Unsupported local content draft')
          const image = await localLibraryRepository.stageNoteImage(local.ref, draftId, context.targetId, entry.file, controller.signal)
          return { data: { ...image, kind: 'image' as const, url: '', localSource: { book: local.ref, id: image.id } } }
        })() : (isCachedRemote && typeof navigator !== 'undefined' && navigator.onLine === false)
          ? await stageOfflineImage()
          : await apiUpload<{ data: ContentFile }>(`/content-files?${query}`, entry.file, 'POST', {
              signal: controller.signal,
              onProgress: (progress) => {
                if (mounted.current && owner.current === ownerKey) setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, progress } : row))
              },
            }).catch(async (error: unknown) => {
              if (isCachedRemote && isOfflineOrNetworkError(error)) return stageOfflineImage()
              throw error
            })
        controller.signal.throwIfAborted()
        if (mounted.current && owner.current === ownerKey) {
          setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, status: 'ready', resource: result.data } : row))
          onUploaded(result.data)
        }
      } finally { controllers.current.delete(entry.id) }
    },
    onError: (_error, entry) => {
      if (mounted.current && owner.current === ownerKey) setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, status: 'failed' } : row))
    },
  })

  function add(file: File, kind: ContentUploadEntry['kind']) {
    touched.current = true
    const entry: ContentUploadEntry = { id: interactionRequestId(), file, kind, progress: 0, status: 'uploading' }
    setEntries((rows) => [...rows, entry])
    upload.mutate(entry)
  }
  function retry(entry: ContentUploadEntry) {
    if (controllers.current.has(entry.id)) return
    setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, status: 'uploading', progress: 0 } : row))
    upload.mutate(entry)
  }
  function dismiss(entryId: string) {
    controllers.current.get(entryId)?.abort()
    controllers.current.delete(entryId)
    setEntries((rows) => rows.filter((row) => row.id !== entryId))
  }
  return { draftId, entries, add, retry, dismiss, uploading: entries.some((row) => row.status === 'uploading') }
}
