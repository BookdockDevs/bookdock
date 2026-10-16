import { useEffect, useRef, useState } from 'react'

import { useMutation } from '@tanstack/react-query'

import type { ContentFile, ContentFileUpload } from '@bookdock/shared'

import { apiDelete, apiUpload } from '@/api/client'
import { interactionRequestId } from '@/lib/interaction-request'

export interface ContentUploadEntry {
  id: string
  file: File
  kind: 'image' | 'attachment'
  progress: number
  status: 'uploading' | 'ready' | 'failed'
  resource?: ContentFile
}

export function useContentDraft(context: Omit<ContentFileUpload, 'draftId' | 'kind'>, onUploaded: (file: ContentFile) => void) {
  const [draftId] = useState(interactionRequestId)
  const [entries, setEntries] = useState<ContentUploadEntry[]>([])
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
        if (!mounted.current && touched.current) void apiDelete(`/content-files/drafts/${draftId}`).catch(() => {})
      })
    }
  }, [draftId])

  const upload = useMutation({
    mutationFn: async (entry: ContentUploadEntry) => {
      const controller = new AbortController()
      controllers.current.set(entry.id, controller)
      const query = new URLSearchParams({ domain: context.domain, bookVersionId: context.bookVersionId, draftId, kind: entry.kind })
      if (context.targetId) query.set('targetId', context.targetId)
      try {
        const result = await apiUpload<{ data: ContentFile }>(`/content-files?${query}`, entry.file, 'POST', {
          signal: controller.signal,
          onProgress: (progress) => {
            if (mounted.current) setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, progress } : row))
          },
        })
        if (mounted.current) {
          setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, status: 'ready', resource: result.data } : row))
          onUploaded(result.data)
        }
      } finally { controllers.current.delete(entry.id) }
    },
    onError: (_error, entry) => {
      if (mounted.current) setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, status: 'failed' } : row))
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
