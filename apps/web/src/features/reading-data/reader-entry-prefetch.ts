import { useCallback, useContext } from 'react'
import { QueryClientContext, type QueryClient } from '@tanstack/react-query'

import type { BookDetailRes, ChapterListRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { LOCAL_VAULT_ID } from '@/features/local-library/id'
import { openLocalReaderSession } from '@/features/local-library/reader-session'
import { withReveal } from '@/lib/reveal-hidden'

export interface WarmReaderEntryOptions {
  bookId: string
  isLocal: boolean
  prefetch?: boolean
}

export function preloadReaderRouteModule(isLocal: boolean): void {
  void (isLocal
    ? import('@/features/local-library/LocalReaderRoute')
    : import('@/features/reader/Reader'))
}

/**
 * Seeds source dispatch and starts loading reader payloads at click/open time
 * so /books/$id does not stall behind sequential route-dispatch queries.
 */
export function warmReaderEntry(
  queryClient: QueryClient | undefined,
  { bookId, isLocal, prefetch = true }: WarmReaderEntryOptions,
): void {
  if (!bookId) return
  preloadReaderRouteModule(isLocal)
  if (!queryClient) return

  queryClient.setQueryData(['book-source-resolve', bookId], isLocal)
  if (!prefetch) return

  if (isLocal) {
    void queryClient.prefetchQuery({
      queryKey: ['local-library', 'session', LOCAL_VAULT_ID, bookId],
      queryFn: () => openLocalReaderSession({ scope: { kind: 'local', vaultId: LOCAL_VAULT_ID }, bookId }),
      staleTime: Infinity,
    })
    return
  }

  void queryClient.prefetchQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(withReveal(`/books/${encodeURIComponent(bookId)}`)),
    staleTime: 10_000,
  })
  void queryClient.prefetchQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => apiGet<ChapterListRes>(withReveal(`/books/${encodeURIComponent(bookId)}/chapters`)),
    staleTime: 10_000,
  })
}

export function useWarmReaderEntry() {
  const queryClient = useContext(QueryClientContext)
  return useCallback(
    (options: WarmReaderEntryOptions) => warmReaderEntry(queryClient, options),
    [queryClient],
  )
}
