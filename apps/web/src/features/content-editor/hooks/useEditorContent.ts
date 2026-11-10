import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { BookDetailRes, ClientLibraryDetailView, EditorAccessRes, EditorEpubLoadRes, EditorEpubSaveReq, EditorTxtDecodeRes, EditorTxtSaveReq, EditorTxtSaveRes } from '@bookdock/shared'

import { apiGet, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { useBook } from '@/features/library/hooks'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'
import { localRecordId } from '@/features/local-library/id'
import { withReveal } from '@/lib/reveal-hidden'
import type { EditorPublicationSource } from '../lib/editor-publication-source'
import { editorSourceRevision } from '../lib/editor-publication-source'
import { readEditorResource } from '@/features/local-library/epub-editor'
import { fetchReaderManifest, ReaderContentSession } from '@/features/reader/lib/reader-content-client'

export function editorContentUrl(book: Pick<BookDetailRes, 'id' | 'revisionId' | 'updatedAt'>): string {
  const revisionId = book.revisionId ? `&revisionId=${encodeURIComponent(book.revisionId)}` : ''
  return withReveal(`/api/v1/books/${encodeURIComponent(book.id)}/file?reader=1${revisionId}&v=${book.updatedAt}`)
}

export function useEditorBook(bookId: string) {
  return useBook(bookId)
}

export interface ManagedEditorTarget {
  libraryId: string
  libraryBookId: string
  versionLinkId: string
}

export function editorAccessPath(bookId: string, target?: ManagedEditorTarget) {
  return target
    ? `/libraries/${encodeURIComponent(target.libraryId)}/books/${encodeURIComponent(target.libraryBookId)}/versions/${encodeURIComponent(target.versionLinkId)}/content/${encodeURIComponent(bookId)}/editor-access`
    : `/books/${encodeURIComponent(bookId)}/editor-access`
}

export function fetchEditorAccess(bookId: string, target?: ManagedEditorTarget) {
  return apiGet<{ data: EditorAccessRes }>(editorAccessPath(bookId, target))
}

export function decodeEditorTxtFile(bookId: string, file: File) {
  return apiUpload<{ data: EditorTxtDecodeRes }>(`/books/${encodeURIComponent(bookId)}/editor-txt-decode`, file)
}

export function useSaveEditorTxt(bookId: string, target?: ManagedEditorTarget) { return useSaveEditorContent<EditorTxtSaveReq>('txt', bookId, target) }
export function useSaveEditorEpub(bookId: string, target?: ManagedEditorTarget) { return useSaveEditorContent<EditorEpubSaveReq>('epub', bookId, target) }

function useSaveEditorContent<T extends EditorTxtSaveReq | EditorEpubSaveReq>(format: 'txt' | 'epub', bookId: string, target?: ManagedEditorTarget) {
  const queryClient = useQueryClient()
  const local = useLocalCatalog()
  const account = useAuthStore((state) => state.user)
  const epoch = getAuthSessionRevision()
  const namespace = local ? `local:${JSON.stringify(local.scope)}:${bookId}` : null
  const { identities, controllers } = useMemo(() => ({ namespace, identities: new WeakMap<T, string>(), controllers: new Set<AbortController>() }), [namespace])
  useEffect(() => () => { for (const controller of controllers) controller.abort() }, [controllers])
  return useMutation({
    mutationKey: ['save-editor', format, namespace ?? bookId, ...(local ? [] : [account?.id ?? null, epoch])], networkMode: local ? 'always' : 'online',
    mutationFn: async (draft: T) => {
      if (local) {
        let identity = identities.get(draft)
        if (!identity) { identity = localRecordId(); identities.set(draft, identity) }
        const controller = new AbortController()
        controllers.add(controller)
        try { return format === 'txt'
          ? await local.operations.saveTxt({ scope: local.scope, bookId }, draft as EditorTxtSaveReq, identity, controller.signal)
          : await local.operations.saveEpub({ scope: local.scope, bookId }, draft as EditorEpubSaveReq, identity, controller.signal) }
        finally { controllers.delete(controller) }
      }
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      const path = format === 'epub' ? editorEpubPath(bookId, target) : target
        ? `/libraries/${encodeURIComponent(target.libraryId)}/books/${encodeURIComponent(target.libraryBookId)}/versions/${encodeURIComponent(target.versionLinkId)}/content/${encodeURIComponent(bookId)}/editor-content`
        : `/books/${encodeURIComponent(bookId)}/editor-content`
      const result = await apiPut<{ data: EditorTxtSaveRes }>(path, draft)
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      return result
    },
    onSuccess: async () => {
      if (!local && getAuthSessionRevision() !== epoch) return
      if (local) {
        await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'client-catalog' || query.queryKey.some((part) => typeof part === 'string' && part.startsWith('local:') && part.includes(JSON.stringify(local.scope))) })
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['progress', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['replacements', 'book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['content-editor', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['reader-content'] }),
        ...(target ? [queryClient.invalidateQueries({ queryKey: ['libraries', target.libraryId, 'catalog'] })] : []),
      ])
    },
  })
}

function editorEpubPath(bookId: string, target?: ManagedEditorTarget): string {
  return target
    ? `/libraries/${encodeURIComponent(target.libraryId)}/books/${encodeURIComponent(target.libraryBookId)}/versions/${encodeURIComponent(target.versionLinkId)}/content/${encodeURIComponent(bookId)}/editor-epub-content`
    : `/books/${encodeURIComponent(bookId)}/editor-epub-content`
}

export function useEditorEpubSource(bookId: string, revisionId: string | null | undefined, enabled: boolean, target?: ManagedEditorTarget) {
  const local = useLocalCatalog()
  const epoch = getAuthSessionRevision()
  return useQuery({
    queryKey: ['content-editor', 'epub-source', local ? `local:${JSON.stringify(local.scope)}:${bookId}` : bookId, revisionId, ...(local ? [] : [target?.versionLinkId, epoch])],
    networkMode: local ? 'always' : 'online',
    queryFn: async ({ signal }) => {
      if (local) return local.operations.readEpubSource({ scope: local.scope, bookId }, revisionId!, signal)
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      const result = await apiGet<{ data: EditorEpubLoadRes }>(editorEpubPath(bookId, target), signal)
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      return result
    },
    enabled: enabled && Boolean(revisionId),
  })
}

export function useEditorChapters(bookId: string, enabled: boolean, revisionId?: string | null) {
  const local = useLocalCatalog()
  const remote = useBookChapters(bookId, enabled && !local)
  const device = useQuery({
    queryKey: ['content-editor', local ? `local:${JSON.stringify(local.scope)}:${bookId}` : null, 'txt-chapters', revisionId],
    networkMode: 'always', enabled: Boolean(local && enabled && revisionId),
    queryFn: async () => {
      const entry = await local!.operations.detail({ scope: local!.scope, bookId })
      if (entry.book.content?.contentId !== revisionId || !entry.book.textSource) throw new Error('TXT content revision changed')
      return { data: entry.book.textSource.chapters.map((chapter, index) => ({ ...chapter, id: `ch-${index}-${chapter.startOffset}` })) }
    },
  })
  return local ? device : remote
}

export function useEditorTxtSource(book: ClientLibraryDetailView | undefined) {
  const local = useLocalCatalog()
  const epoch = getAuthSessionRevision()
  return useQuery({
    queryKey: ['content-editor', local ? `local:${JSON.stringify(local.scope)}:${book?.id}` : book?.id, 'txt-source', book?.revisionId, ...(local ? [] : [epoch])],
    networkMode: local ? 'always' : 'online',
    queryFn: async ({ signal }) => {
      if (!book) throw new Error('Book content is unavailable')
      if (local) return local.operations.readTxtSource({ scope: local.scope, bookId: book.id }, book.revisionId!, signal)
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      const url = withReveal(`${BASE_URL}/books/${encodeURIComponent(book.id)}/content?revisionId=${encodeURIComponent(book.revisionId ?? '')}`)
      const response = await fetch(url, { credentials: 'include', signal })
      if (!response.ok) throw new Error('Book content could not be loaded')
      const text = await response.text()
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      return text
    },
    enabled: Boolean(book?.format === 'txt'),
  })
}

export function useEditorManifest(book: ClientLibraryDetailView | undefined) {
  const local = useLocalCatalog()
  const epoch = getAuthSessionRevision()
  const contentUrl = book && !local ? editorContentUrl(book) : null
  return useQuery({
    queryKey: ['content-editor', 'manifest', local ? `local:${JSON.stringify(local.scope)}:${book?.id}` : book?.id, book?.revisionId, book?.updatedAt, ...(local ? [] : [epoch])],
    networkMode: local ? 'always' : 'online',
    queryFn: async ({ signal }): Promise<EditorPublicationSource> => {
      if (!book) throw new Error('Book content is unavailable')
      if (local) return local.operations.epubResources({ scope: local.scope, bookId: book.id }, book.revisionId!, signal)
      if (!contentUrl || getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      const loaded = await fetchReaderManifest(contentUrl, signal)
      if (getAuthSessionRevision() !== epoch) throw new DOMException('Editor account changed', 'AbortError')
      if (book.revisionId && loaded.manifest.revisionId !== book.revisionId) throw new Error('Book content revision changed while opening the editor')
      return { ...loaded, contentUrl }
    },
    enabled: Boolean(book?.format === 'epub' && book.revisionId),
  })
}

export function useEditorSpineText(book: ClientLibraryDetailView | undefined, loaded: EditorPublicationSource | undefined, path: string | undefined) {
  const local = useLocalCatalog()
  return useQuery({
    queryKey: ['content-editor', 'spine-text', local ? `local:${JSON.stringify(local.scope)}:${book?.id}` : book?.id, loaded && editorSourceRevision(loaded), path],
    networkMode: local ? 'always' : 'online',
    queryFn: async ({ signal }) => {
      if (!book || !loaded || !path) throw new Error('Spine content is unavailable')
      if (loaded.kind === 'local') {
        const text = await readEditorResource(loaded.file, path, undefined, signal)
        if (typeof text !== 'string') throw new Error('Spine content is unavailable')
        return text
      }
      const session = new ReaderContentSession(loaded.manifest, loaded.accountScope, loaded.epoch, loaded.contentUrl, true)
      const release = session.retain()
      try {
        const text = await session.loadText(path, 'foreground', signal)
        if (text === null) throw new Error('Spine content is unavailable')
        return text
      } finally { release() }
    },
    enabled: Boolean(book && loaded && path),
  })
}
