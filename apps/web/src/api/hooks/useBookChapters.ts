import { useQuery } from '@tanstack/react-query'

import type { ChapterListRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'

export function useBookChapters(bookId: string, enabled = true) {
  const local = useLocalCatalog()
  return useQuery({
    queryKey: ['chapters', local ? ['local', local.scope.vaultId, bookId] : bookId],
    queryFn: () => {
      if (local) throw new Error('Use source-owned publication structure for local content')
      return apiGet<ChapterListRes>(withReveal(`/books/${bookId}/chapters`))
    },
    enabled: enabled && Boolean(bookId),
  })
}
