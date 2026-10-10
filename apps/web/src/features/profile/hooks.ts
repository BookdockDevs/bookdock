import { useQuery } from '@tanstack/react-query'

import type { ArchivePage, NoteArchiveEntry } from '@bookdock/shared'

import { apiGet } from '@/api/client'

export function useNoteArchive(page = 1, bookId?: string) {
  return useQuery({
    queryKey: ['note-archive', page, bookId],
    queryFn: () => apiGet<{ data: ArchivePage<NoteArchiveEntry> }>(`/annotations/mine?${new URLSearchParams({ page: String(page), ...(bookId ? { bookId } : {}) })}`),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}
