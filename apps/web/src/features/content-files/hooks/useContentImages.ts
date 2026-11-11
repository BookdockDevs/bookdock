import { useContext, useEffect, useState } from 'react'
import { QueryClientContext, useQueries } from '@tanstack/react-query'

import { clientBookKey } from '@bookdock/shared'
import type { ContentFile } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'
import { localLibraryRepository } from '@/features/local-library/repository'
import { remoteBookCache, remoteCacheScopeKey } from '@/features/remote-cache/remote-book-cache'

export interface ResolvedContentImage extends ContentFile { resourceUnavailable?: boolean; retryResource?: () => void }

export function useContentImages(images: ContentFile[] = []): ResolvedContentImage[] {
  const client = useContext(QueryClientContext) ?? queryClient
  const resources = useQueries({ combine: (results) => results.map((query) => ({ blob: query.data, failed: query.isError, retry: query.refetch })), queries: images.map((image) => ({
    queryKey: ['local-note-image', ...(image.localSource ? clientBookKey(image.localSource.book) : []), image.id],
    networkMode: 'always' as const, enabled: Boolean(image.localSource),
    queryFn: async () => {
      const source = image.localSource!
      if (source.book.scope.kind === 'local') {
        return localLibraryRepository.readNoteImage(source.book, source.id)
      }
      const accountId = source.book.scope.kind === 'remote' ? source.book.scope.accountId : null
      const blob = await remoteBookCache.getOutboxImage(remoteCacheScopeKey(accountId), source.book.bookId, source.id)
      if (!blob) throw new Error('Offline image is unavailable')
      return blob
    },
    gcTime: 0,
  })) }, client)
  const [leases, setLeases] = useState<Array<{ blob: Blob; url: string }>>([])
  useEffect(() => {
    const next = resources.flatMap(({ blob }) => blob ? [{ blob, url: URL.createObjectURL(blob) }] : [])
    setLeases(next)
    return () => { for (const lease of next) URL.revokeObjectURL(lease.url) }
  }, [resources])
  return images.map((image, index) => image.localSource ? { ...image, url: leases.find((lease) => lease.blob === resources[index]?.blob)?.url ?? '', resourceUnavailable: resources[index]?.failed, retryResource: () => { void resources[index]?.retry() } } : image)
}
