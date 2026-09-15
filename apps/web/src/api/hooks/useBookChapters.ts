import { useQuery } from '@tanstack/react-query'

import type { ChapterListRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'

export function useBookChapters(bookId: string, enabled = true) {
  return useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => apiGet<ChapterListRes>(`/books/${bookId}/chapters`),
    enabled: enabled && Boolean(bookId),
  })
}
