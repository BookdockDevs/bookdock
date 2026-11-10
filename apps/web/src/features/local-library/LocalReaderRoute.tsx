import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import Reader from '../reader/Reader'
import { LocalReaderContext } from '../reading-data/reader-source-context'
import { openLocalReaderSession } from './reader-session'
import { useTranslation } from '@/hooks/useTranslation'

import { LOCAL_VAULT_ID } from './id'

export default function LocalReaderRoute() {
  const _ = useTranslation()
  const { id } = useParams({ strict: false }) as { id: string }
  const session = useQuery({
    queryKey: ['local-library', 'session', LOCAL_VAULT_ID, id],
    queryFn: () => openLocalReaderSession({ scope: { kind: 'local', vaultId: LOCAL_VAULT_ID }, bookId: id }),
    networkMode: 'always', staleTime: 0, gcTime: 0, refetchOnMount: 'always',
  })
  if (session.isPending) return <div className="p-8" role="status"><div className="h-64 animate-pulse rounded-xl bg-stone-500/10" /></div>
  if (session.isError) return <div className="space-y-4 p-8"><p role="alert">{_('localLibrary.missing')}</p><a href="/" className="underline">{_('reader.back')}</a></div>
  return <LocalReaderContext.Provider value={session.data}><Reader key={session.data.namespace} /></LocalReaderContext.Provider>
}
