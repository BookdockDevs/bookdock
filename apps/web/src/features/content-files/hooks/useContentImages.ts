import { useContext, useEffect, useState } from 'react'
import { QueryClientContext, useQueries } from '@tanstack/react-query'

import { clientBookKey } from '@bookdock/shared'
import type { ContentFile } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'
import { localLibraryRepository } from '@/features/local-library/repository'

export interface ResolvedContentImage extends ContentFile { resourceUnavailable?: boolean; retryResource?: () => void }

export function useContentImages(images: ContentFile[] = []): ResolvedContentImage[] {
  const client = useContext(QueryClientContext) ?? queryClient
  const resources = useQueries({ combine: (results) => results.map((query) => ({ blob: query.data, failed: query.isError, retry: query.refetch })), queries: images.map((image) => ({
    queryKey: ['local-note-image', ...(image.localSource ? clientBookKey(image.localSource.book) : []), image.id],
    networkMode: 'always' as const, enabled: Boolean(image.localSource),
    queryFn: () => localLibraryRepository.readNoteImage(image.localSource!.book, image.localSource!.id),
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
