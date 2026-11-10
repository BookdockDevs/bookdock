import type { ComponentProps } from 'react'

import { useQuery } from '@tanstack/react-query'

import QueryErrorState from '@/components/ui/QueryErrorState'
import BookNotesView from '@/features/archive/BookNotesView'
import { LocalReaderContext } from '@/features/reading-data/reader-source-context'

import { LOCAL_VAULT_ID } from './id'
import { openLocalReaderSession } from './reader-session'

export default function LocalBookArchive(props: ComponentProps<typeof BookNotesView>) {
  const id = props.bookVersionId
  const session = useQuery({
    queryKey: ['local-library', 'archive-session', LOCAL_VAULT_ID, id],
    queryFn: () => openLocalReaderSession({ scope: { kind: 'local', vaultId: LOCAL_VAULT_ID }, bookId: id }, true),
    networkMode: 'always', staleTime: 0, gcTime: 0,
  })
  if (session.isPending) return <div role="status" className="flex flex-col gap-3 p-8">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-500/10" />)}</div>
  if (session.isError) return <QueryErrorState className="p-8" isRetrying={session.isFetching} onRetry={() => void session.refetch()} />
  return <LocalReaderContext.Provider value={session.data}>
    <BookNotesView key={session.data.namespace} {...props} />
  </LocalReaderContext.Provider>
}
