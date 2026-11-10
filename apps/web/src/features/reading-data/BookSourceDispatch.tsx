import { lazy, Suspense } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import ReaderPending from '@/features/reader/components/ReaderPending'
import ContentEditorPending from '@/features/content-editor/components/ContentEditorPending'
import { localLibraryRepository } from '@/features/local-library/repository'
import { LOCAL_VAULT_ID } from '@/features/local-library/id'
import type { ClientBookRef } from '@bookdock/shared'

const Reader = lazy(() => import('@/features/reader/Reader'))
const LocalReaderRoute = lazy(() => import('@/features/local-library/LocalReaderRoute'))
const LocalCatalogProvider = lazy(() => import('@/features/local-library/LocalCatalogProvider'))
const ContentEditorPage = lazy(() => import('@/features/content-editor/ContentEditorPage'))

/**
 * Single-route source dispatch: the route id resolves against the device
 * vault, and the matching surface renders. Both branches stay lazily loaded so
 * remote readers never pull the vault bundle and vice versa.
 */
function useRouteBookIsLocal(bookId: string | undefined) {
  return useQuery({
    queryKey: ['book-source-resolve', bookId],
    queryFn: async () => {
      if (!bookId) return false
      const ref: ClientBookRef = { scope: { kind: 'local', vaultId: LOCAL_VAULT_ID }, bookId }
      try {
        await localLibraryRepository.getBook(ref)
        return true
      } catch {
        return false
      }
    },
    enabled: Boolean(bookId),
    // Vault resolution must settle offline; the default networkMode would
    // pause it and leave the dispatch pending forever.
    networkMode: 'always',
    staleTime: 0,
  })
}

export function BookReaderDispatch() {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: isLocal, isPending } = useRouteBookIsLocal(id)
  if (isPending) return <ReaderPending />
  return isLocal
    ? <Suspense fallback={<ReaderPending />}><LocalReaderRoute /></Suspense>
    : <Suspense fallback={<ReaderPending />}><Reader /></Suspense>
}

export function BookEditorDispatch() {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: isLocal, isPending } = useRouteBookIsLocal(id)
  if (isPending) return <ContentEditorPending />
  const page = <Suspense fallback={<ContentEditorPending />}><ContentEditorPage /></Suspense>
  if (!isLocal) return page
  return (
    <Suspense fallback={<ContentEditorPending />}>
      <LocalCatalogProvider>{page}</LocalCatalogProvider>
    </Suspense>
  )
}
