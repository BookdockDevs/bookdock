import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { BookDetailRes, EditorAccessRes, EditorEpubLoadRes, EditorEpubSaveReq, EditorTxtDecodeRes, EditorTxtSaveReq, EditorTxtSaveRes, ReaderManifest } from '@bookdock/shared'

import { apiGet, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { useBook } from '@/features/library/hooks'
import { withReveal } from '@/lib/reveal-hidden'
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

export function useSaveEditorTxt(bookId: string, target?: ManagedEditorTarget) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: EditorTxtSaveReq) => {
      const path = target
        ? `/libraries/${encodeURIComponent(target.libraryId)}/books/${encodeURIComponent(target.libraryBookId)}/versions/${encodeURIComponent(target.versionLinkId)}/content/${encodeURIComponent(bookId)}/editor-content`
        : `/books/${encodeURIComponent(bookId)}/editor-content`
      return apiPut<{ data: EditorTxtSaveRes }>(path, draft)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['progress', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['annotations', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['replacements', 'book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['content-editor', bookId] }),
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
  return useQuery({
    queryKey: ['content-editor', 'epub-source', bookId, revisionId, target?.versionLinkId],
    queryFn: ({ signal }) => apiGet<{ data: EditorEpubLoadRes }>(editorEpubPath(bookId, target), signal),
    enabled: enabled && Boolean(revisionId),
  })
}

export function useSaveEditorEpub(bookId: string, target?: ManagedEditorTarget) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: EditorEpubSaveReq) => apiPut<{ data: EditorTxtSaveRes }>(editorEpubPath(bookId, target), draft),
    onSuccess: async () => {
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

export function useEditorChapters(bookId: string, enabled: boolean) {
  return useBookChapters(bookId, enabled)
}

export function useEditorTxtSource(book: BookDetailRes | undefined) {
  return useQuery({
    queryKey: ['content-editor', 'txt-source', book?.id, book?.revisionId],
    queryFn: async ({ signal }) => {
      if (!book) throw new Error('Book content is unavailable')
      const url = withReveal(`${BASE_URL}/books/${encodeURIComponent(book.id)}/content?revisionId=${encodeURIComponent(book.revisionId ?? '')}`)
      const response = await fetch(url, { credentials: 'include', signal })
      if (!response.ok) throw new Error('Book content could not be loaded')
      return response.text()
    },
    enabled: Boolean(book?.format === 'txt'),
  })
}

export function useEditorManifest(book: BookDetailRes | undefined) {
  const contentUrl = book ? editorContentUrl(book) : null
  return useQuery({
    queryKey: ['content-editor', 'manifest', book?.id, book?.revisionId, book?.updatedAt],
    queryFn: async ({ signal }): Promise<{ manifest: ReaderManifest; contentUrl: string; epoch: number; accountScope: string }> => {
      if (!book || !contentUrl) throw new Error('Book content is unavailable')
      const loaded = await fetchReaderManifest(contentUrl, signal)
      if (book.revisionId && loaded.manifest.revisionId !== book.revisionId) {
        throw new Error('Book content revision changed while opening the editor')
      }
      return { ...loaded, contentUrl }
    },
    enabled: Boolean(book && contentUrl),
  })
}

export function useEditorSpineText(
  book: BookDetailRes | undefined,
  loaded: { manifest: ReaderManifest; contentUrl: string; epoch: number; accountScope: string } | undefined,
  path: string | undefined,
) {
  return useQuery({
    queryKey: ['content-editor', 'spine-text', book?.id, loaded?.manifest.revisionId, path],
    queryFn: async ({ signal }) => {
      if (!book || !loaded || !path) throw new Error('Spine content is unavailable')
      const session = new ReaderContentSession(loaded.manifest, loaded.accountScope, loaded.epoch, loaded.contentUrl, true)
      const release = session.retain()
      try {
        const text = await session.loadText(path, 'foreground', signal)
        if (text === null) throw new Error('Spine content is unavailable')
        return text
      } finally {
        release()
      }
    },
    enabled: Boolean(book && loaded && path),
  })
}
