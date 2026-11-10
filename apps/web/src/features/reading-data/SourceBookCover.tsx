import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import BookCoverImage from '../library/components/BookCoverImage'
import type { BookCoverProps } from '../library/components/BookCoverImage'
import { localLibraryRepository } from '../local-library/repository'
import { catalogQueryKey } from './catalog'
import { useLocalCatalog } from './catalog-source-context'

export default function SourceBookCover(props: BookCoverProps) {
  const ref = props.book.ref!
  const source = useLocalCatalog()
  const cover = useQuery({
    networkMode: 'always',
    queryKey: catalogQueryKey(ref.scope, 'cover', [ref.bookId, props.book.clientVersion]),
    queryFn: async ({ signal }) => {
      const blob = await (source ? source.operations.getCover(ref) : localLibraryRepository.getCover(ref))
      signal.throwIfAborted()
      return blob
    },
  })
  const [lease, setLease] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!cover.data) { setLease(null); return }
    const url = URL.createObjectURL(cover.data)
    setLease({ blob: cover.data, url })
    return () => URL.revokeObjectURL(url)
  }, [cover.data])
  return <BookCoverImage {...props} coverSrc={cover.data && lease?.blob === cover.data ? lease.url : null} />
}
