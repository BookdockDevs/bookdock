import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Chapter } from '@bookdock/shared'

import { useBookChapters as useRemoteBookChapters } from '@/api/hooks/useBookChapters'
import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { useTranslation } from '@/hooks/useTranslation'

export interface ReaderChapterView extends Omit<Chapter, 'startOffset' | 'endOffset'> {
  startOffset: number | null
  endOffset: number | null
  href?: string
}

export function useBookChapters(bookId: string, enabled = true): UseQueryResult<{ data: ReaderChapterView[] }> {
  const local = useLocalReader()
  const _ = useTranslation()
  const remote = useRemoteBookChapters(bookId, enabled && !local)
  const localQuery = useQuery({
    queryKey: ['chapters', local?.namespace ?? null],
    queryFn: async ({ signal }): Promise<{ data: ReaderChapterView[] }> => {
      if (!local) throw new Error('Local reader source is unavailable')
      const structure = await local.getStructure(signal)
      return { data: structure.sections.map((section) => ({
        id: section.href ?? `section:${section.index}`, title: section.title ?? _('reader.aiChapterNumber', { n: section.index + 1 }), level: 1,
        startOffset: null, endOffset: null, ...(section.href ? { href: section.href } : {}),
        ...(section.wordCount !== null ? { wordCount: section.wordCount } : {}),
      })) }
    },
    networkMode: 'always',
    enabled: enabled && Boolean(bookId) && Boolean(local),
  })
  return local ? localQuery : remote
}
