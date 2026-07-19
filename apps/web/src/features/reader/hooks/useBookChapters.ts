import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import type { ChapterListRes } from '@bookdock/shared'

export function useBookChapters(bookId: string) {
  return useQuery({
    queryKey: ['chapters', bookId],
    queryFn: () => apiGet<ChapterListRes>(`/books/${bookId}/chapters`),
    enabled: !!bookId,
  })
}
