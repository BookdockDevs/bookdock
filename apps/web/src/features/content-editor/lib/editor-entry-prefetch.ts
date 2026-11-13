import type { QueryClient } from '@tanstack/react-query'

import type { ClientLibraryDetailView, EditorEpubLoadRes } from '@bookdock/shared'

import { apiGet, BASE_URL } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { getAuthSessionRevision } from '@/stores/auth.store'

export interface ManagedEditorTarget {
  libraryId: string
  libraryBookId: string
  versionLinkId: string
}

export type EditorBookIdentity = Pick<ClientLibraryDetailView, 'id' | 'format' | 'revisionId'>

export function editorEpubPath(bookId: string, target?: ManagedEditorTarget): string {
  return target
    ? `/libraries/${encodeURIComponent(target.libraryId)}/books/${encodeURIComponent(target.libraryBookId)}/versions/${encodeURIComponent(target.versionLinkId)}/content/${encodeURIComponent(bookId)}/editor-epub-content`
    : `/books/${encodeURIComponent(bookId)}/editor-epub-content`
}

export function remoteEditorTxtSourceKey(bookId: string, revisionId: string | null | undefined, epoch: number) {
  return ['content-editor', bookId, 'txt-source', revisionId, epoch]
}

export function remoteEditorEpubSourceKey(bookId: string, revisionId: string | null | undefined, target: ManagedEditorTarget | undefined, epoch: number) {
  return ['content-editor', 'epub-source', bookId, revisionId, target?.versionLinkId, epoch]
}

export async function fetchEditorTxtSource(book: EditorBookIdentity, signal?: AbortSignal): Promise<string> {
  const url = withReveal(`${BASE_URL}/books/${encodeURIComponent(book.id)}/content?revisionId=${encodeURIComponent(book.revisionId ?? '')}`)
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) throw new Error('Book content could not be loaded')
  return response.text()
}

export function fetchEditorEpubSource(bookId: string, target?: ManagedEditorTarget, signal?: AbortSignal) {
  return apiGet<{ data: EditorEpubLoadRes }>(editorEpubPath(bookId, target), signal)
}

export function preloadEditorRouteModule(): void {
  // Skip the lazy chunk preload under Vitest so tests that navigate and exit
  // immediately do not race Vite environment teardown mid-import.
  if (import.meta.env.MODE === 'test') return
  void import('@/features/content-editor/ContentEditorPage').catch(() => undefined)
}

/**
 * Starts loading the editor payload at click time, mirroring warmReaderEntry:
 * the content request overlaps the editor chunk download and route transition
 * instead of waiting for the workbench to mount. The revision comes from the
 * book detail the opening surface already cached; when it turns out to be
 * stale the editor simply fetches under its new revision key.
 */
export function warmEditorEntry(queryClient: QueryClient | undefined, { bookId, target }: { bookId: string; target?: ManagedEditorTarget }): void {
  preloadEditorRouteModule()
  if (!queryClient || !bookId) return
  const book = queryClient.getQueryData<{ data: ClientLibraryDetailView }>(['books', 'detail', bookId])?.data
  if (!book?.revisionId) return
  const epoch = getAuthSessionRevision()
  if (book.format === 'txt') {
    void queryClient.prefetchQuery({
      queryKey: remoteEditorTxtSourceKey(bookId, book.revisionId, epoch),
      queryFn: ({ signal }) => fetchEditorTxtSource(book, signal),
    })
    return
  }
  if (book.format === 'epub') {
    void queryClient.prefetchQuery({
      queryKey: remoteEditorEpubSourceKey(bookId, book.revisionId, target, epoch),
      queryFn: () => fetchEditorEpubSource(bookId, target),
    })
  }
}
