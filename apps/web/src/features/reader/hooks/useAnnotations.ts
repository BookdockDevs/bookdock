import { useRef } from 'react'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { ANNOTATION_MAX_TEXT_LENGTH, ErrorCode } from '@bookdock/shared'
import type { AnnotationRes, AnnotationCreateReq, AnnotationUpdateReq, UndoReceipt } from '@bookdock/shared'

import { ApiError, apiGet, apiPost, apiPut, apiDelete } from '@/api/client'
import { invalidateActivityQueries } from '@/features/activity/hooks'
import { withReveal } from '@/lib/reveal-hidden'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'

import { cfiRangesOverlap, loadCfiModule } from '../lib/cfi-overlap'
import { useLocalReader } from '../../reading-data/reader-source-context'
import { localRecordId } from '../../local-library/reader-session'

type AnnotationsCache = { data: AnnotationRes[] }

function useAnnotationSource(bookId: string) {
  const local = useLocalReader()
  const user = useAuthStore((state) => state.user)
  const revision = getAuthSessionRevision()
  const key = local ? ['annotations', local.namespace, bookId] : ['annotations', bookId]
  return { local, key,
    mutationKey: ['annotation-command', local?.namespace ?? 'remote', bookId, ...(local ? [] : [user?.id ?? null, revision])],
    isCurrent: () => Boolean(local) || getAuthSessionRevision() === revision,
    assertOwner() {
      if (!local && getAuthSessionRevision() !== revision) throw new DOMException('Annotation account changed', 'AbortError')
    },
  }
}

export function useAnnotations(bookId: string, options: { enabled?: boolean } = {}) {
  const { local, key, assertOwner } = useAnnotationSource(bookId)
  return useQuery({
    queryKey: key,
    networkMode: local ? 'always' : 'online',
    queryFn: async () => {
      assertOwner()
      const result = local ? await local.listNotes() : await apiGet<AnnotationsCache>(withReveal(`/annotations/book/${bookId}`))
      assertOwner()
      return result
    },
    enabled: !!bookId && options.enabled !== false,
  })
}

export function useCreateAnnotation(bookId: string) {
  const { local, key, mutationKey, assertOwner, isCurrent } = useAnnotationSource(bookId)
  const queryClient = useQueryClient()
  const replacementIdsByBody = useRef(new WeakMap<object, string[]>()).current
  const commandIds = useRef(new WeakMap<object, string>()).current
  return useMutation({
    mutationKey, networkMode: local ? 'always' : 'online',
    mutationFn: (body: AnnotationCreateReq) => {
      assertOwner()
      const replaceAnnotationIds = replacementIdsByBody.get(body)
      if (local) {
        let commandId = commandIds.get(body)
        if (!commandId) { commandId = localRecordId(); commandIds.set(body, commandId) }
        return local.createNote({ ...body, ...(replaceAnnotationIds?.length ? { replaceAnnotationIds } : {}) }, commandId)
      }
      return apiPost<{ data: AnnotationRes }>(withReveal(`/annotations/book/${bookId}`), {
        ...body,
        ...(replaceAnnotationIds?.length ? { replaceAnnotationIds } : {}),
      })
    },
    onMutate: async (body) => {
      if ((body.text?.length ?? 0) > ANNOTATION_MAX_TEXT_LENGTH) {
        throw new ApiError(ErrorCode.ANNOTATION_TEXT_TOO_LONG, 'Annotation text exceeds the maximum length')
      }
      await queryClient.cancelQueries({ queryKey: key })
      assertOwner()
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      const now = Date.now()
      const optimistic: AnnotationRes = {
        id: `temp-${now}-${Math.random().toString(36).slice(2, 8)}`,
        bookId,
        revisionId: body.revisionId ?? null,
        cfiRange: body.cfiRange,
        cfiAnchor: body.cfiAnchor ?? null,
        type: body.type,
        color: body.color ?? 'yellow',
        style: body.style ?? 'underline',
        text: body.text ?? '',
        contextText: body.contextText ?? null,
        note: body.note ?? null,
        chapter: body.chapter ?? null,
        chapterHref: body.chapterHref ?? null,
        createdAt: now,
        updatedAt: now,
      }
      // A new highlight replaces any overlapping highlight (strategy A).
      // The IDs are sent with the create request so the server can retire the
      // old rows atomically with creating/restoring the new row. Notes and
      // bookmarks never participate.
      let replacedIds: string[] = []
      if (body.type === 'highlight' && previous?.data?.length) {
        try {
          const cfi = await loadCfiModule()
          replacedIds = previous.data
            .filter((a) => a.type === 'highlight' && a.cfiRange !== null && !a.id.startsWith('temp-') && cfiRangesOverlap(cfi, a.cfiRange, body.cfiRange))
            .map((a) => a.id)
        } catch { /* CFI module unavailable — skip replacement */ }
      }
      replacementIdsByBody.set(body, replacedIds)
      const replaced = new Set(replacedIds)
      queryClient.setQueryData<AnnotationsCache>(key, (old) => ({
        data: [...(old?.data ?? []).filter((a) => !replaced.has(a.id)), optimistic],
      }))
      return { replaced: previous?.data.filter((a) => replaced.has(a.id)) ?? [], optimisticId: optimistic.id }
    },
    onError: (_err, _body, context) => {
      if (!isCurrent() || !context) return
      queryClient.setQueryData<AnnotationsCache>(key, (old) => {
        const remaining = (old?.data ?? []).filter((a) => a.id !== context.optimisticId)
        const ids = new Set(remaining.map((a) => a.id))
        return { data: [...remaining, ...context.replaced.filter((a) => !ids.has(a.id))] }
      })
    },
    onSuccess: (res, _body, context) => {
      if (!isCurrent()) return
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old
          ? {
              // A malformed create response must not replace the optimistic
              // entry with undefined (a stale server used to return `{}` on
              // restore); the onSettled refetch self-heals the entry.
              data: old.data.map((a) => (a.id === context?.optimisticId ? (res.data ?? a) : a)),
            }
          : old,
      )
    },
    // Not awaited on purpose: mutateAsync resolves as soon as the POST does,
    // the refetch resyncs the cache (including overlap deletes) in the background
    onSettled: (result, error, body) => {
      if (body) replacementIdsByBody.delete(body)
      if (!isCurrent()) return
      if (local) { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ['archive', local.namespace] }); return }
      void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['idea-composer', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
      if (!error && body.type === 'note') void invalidateActivityQueries(queryClient)
    },
  })
}
export function useUpdateAnnotation(bookId: string) {
  const { local, key, mutationKey, assertOwner, isCurrent } = useAnnotationSource(bookId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey, networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, body, expectedVersion }: { id: string; body: AnnotationUpdateReq; expectedVersion?: number }) => {
      assertOwner()
      return local ? local.updateNote(id, body, expectedVersion) : apiPut<{ data: AnnotationRes }>(`/annotations/${id}`, body)
    },
    onMutate: async ({ id, body }) => {
      if ((body.text?.length ?? 0) > ANNOTATION_MAX_TEXT_LENGTH) {
        throw new ApiError(ErrorCode.ANNOTATION_TEXT_TOO_LONG, 'Annotation text exceeds the maximum length')
      }
      await queryClient.cancelQueries({ queryKey: key })
      assertOwner()
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old
          ? { data: old.data.map((a) => (a.id === id ? { ...a, ...body, updatedAt: Date.now() } : a)) }
          : old,
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (!isCurrent()) return
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    // Not awaited on purpose: the refetch resyncs the cache in the background
    onSettled: (result, error, input) => {
      if (!isCurrent()) return
      if (local) { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ['archive', local.namespace] }); return }
      void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['idea-discussion'] })
      void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      const cachedNote = queryClient.getQueryData<AnnotationsCache>(key)?.data.some((annotation) => annotation.id === input.id && annotation.type === 'note')
      const responseIsNote = result?.data?.type === 'note'
      if (!error && (responseIsNote || cachedNote)) void invalidateActivityQueries(queryClient)
    },
  })
}
export function useDeleteAnnotation(bookId: string) {
  const { local, key, mutationKey, assertOwner, isCurrent } = useAnnotationSource(bookId)
  const queryClient = useQueryClient()
  const versionScope = JSON.stringify(mutationKey)
  const versionsRef = useRef({ scope: versionScope, values: new Map<string, number>() })
  if (versionsRef.current.scope !== versionScope) versionsRef.current = { scope: versionScope, values: new Map() }
  const versions = versionsRef.current.values
  return useMutation({
    mutationKey, networkMode: local ? 'always' : 'online',
    mutationFn: async (target: string | Pick<AnnotationRes, 'id' | 'clientVersion'>): Promise<{ undo?: UndoReceipt }> => {
      assertOwner()
      const id = typeof target === 'string' ? target : target.id
      const version = typeof target === 'string' ? versions.get(id) : target.clientVersion
      if (local && version === undefined) throw new Error('Displayed local note version is required')
      return local ? (await local.deleteNote(id, version), {}) : apiDelete<{ undo?: UndoReceipt }>(`/annotations/${id}`)
    },
    onMutate: async (target) => {
      const id = typeof target === 'string' ? target : target.id
      await queryClient.cancelQueries({ queryKey: key })
      assertOwner()
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      const version = previous?.data.find((note) => note.id === id)?.clientVersion
      if (version !== undefined) versions.set(id, version)
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old ? { data: old.data.filter((a) => a.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (!isCurrent()) return
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => {
      if (!isCurrent()) return
      if (local) { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ['archive', local.namespace] }); return }
      void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['idea-discussion'] })
      // Deleting a whole annotation can retire the notifications pointing at it.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void invalidateActivityQueries(queryClient)
    },
  })
}

export function useBatchDeleteAnnotations(bookId: string) {
  const { local, key, mutationKey, assertOwner, isCurrent } = useAnnotationSource(bookId)
  const queryClient = useQueryClient()
  const versionScope = JSON.stringify(mutationKey)
  const versionsRef = useRef({ scope: versionScope, values: new Map<string, number>() })
  if (versionsRef.current.scope !== versionScope) versionsRef.current = { scope: versionScope, values: new Map() }
  const versions = versionsRef.current.values
  return useMutation({
    mutationKey, networkMode: local ? 'always' : 'online',
    mutationFn: async (targets: string[] | Array<Pick<AnnotationRes, 'id' | 'clientVersion'>>) => {
      assertOwner()
      const ids = targets.map((target) => typeof target === 'string' ? target : target.id)
      if (local) {
        const notes = targets.map((target) => typeof target === 'string' ? { id: target, clientVersion: versions.get(target) } : target)
        if (notes.some((note) => note.clientVersion === undefined)) throw new Error('Displayed local note versions are required')
        await local.deleteNotes(notes)
        return { succeeded: ids.length, failed: 0, undo: undefined }
      }
      const result = await apiPost<{ data: { succeeded: number; failed: number }; undo?: UndoReceipt }>('/annotations/batch-delete', { ids })
      return { ...result.data, undo: result.undo }
    },
    onMutate: async (targets) => {
      const ids = targets.map((target) => typeof target === 'string' ? target : target.id)
      await queryClient.cancelQueries({ queryKey: key })
      assertOwner()
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      for (const note of previous?.data ?? []) if (ids.includes(note.id) && note.clientVersion !== undefined) versions.set(note.id, note.clientVersion)
      const toDelete = new Set(ids)
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old ? { data: old.data.filter((a) => !toDelete.has(a.id)) } : old,
      )
      return { previous }
    },
    onError: (_err, _ids, context) => {
      if (!isCurrent()) return
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSuccess: (result) => {
      if (!isCurrent()) return
      if (!local && result.succeeded > 0) void invalidateActivityQueries(queryClient)
    },
    onSettled: () => {
      if (!isCurrent()) return
      if (local) { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ['archive', local.namespace] }); return }
      void queryClient.invalidateQueries({ queryKey: ['note-archive'] })
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['reader-ideas', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['idea-discussion'] })
      // Batch deletes can retire the notifications pointing at the removed items.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

