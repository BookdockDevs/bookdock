import { useState } from 'react'

import ContentImages from '@/features/content-files/components/ContentImages'

import { Button } from '@/components/ui/Button'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'

import { useNoteArchive } from '../hooks'
import ArchivePager from './ArchivePager'

interface ProfileNotesSectionProps {
  page: number
  bookId?: string
  onChange: (page: number, bookId?: string) => void
}

export default function ProfileNotesSection({ page, bookId, onChange }: ProfileNotesSectionProps) {
  const _ = useTranslation()
  const query = useNoteArchive(page, bookId)
  const [expanded, setExpanded] = useState<string | null>(null)
  const groups = new Map<string, typeof query.data>()
  for (const entry of query.data?.data.entries ?? []) {
    const key = entry.annotation.bookId
    const group = groups.get(key) ?? { data: { entries: [], page, hasMore: false } }
    group.data.entries.push(entry)
    groups.set(key, group)
  }
  return (
    <section aria-label={_('profileArchive.notes')} className="rounded-2xl border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{_('profileArchive.notes')}</h2>
        {bookId && <Button size="sm" variant="ghost" onClick={() => onChange(1)}>{_('profileArchive.allBooks')}</Button>}
      </div>
      <p className="mb-3 text-xs text-stone-500">{_('profileArchive.privateNotes')}</p>
      {query.isPending ? <div role="status" className="h-16 animate-pulse rounded-xl bg-stone-500/10" />
        : query.isError ? <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />
        : groups.size === 0 ? <p className="text-sm text-stone-500">{_('profileArchive.noNotes')}</p>
        : [...groups].map(([id, group]) => (
          <div key={id} className="mb-4 space-y-2">
            <Button size="sm" variant="ghost" onClick={() => onChange(1, id)}>{group?.data.entries[0]?.bookTitle ?? _('review.sourceGoneTitle')}</Button>
            {group?.data.entries.map(({ annotation, locationStatus }) => (
              <article key={annotation.id} className="rounded-xl border border-stone-200/70 p-3 dark:border-stone-800">
                <p className="mb-1 text-xs text-stone-500">{annotation.chapter}</p>
                <button type="button" className="block w-full text-left text-sm text-stone-700 dark:text-stone-200" aria-expanded={expanded === annotation.id} onClick={() => setExpanded(expanded === annotation.id ? null : annotation.id)}>
                  <span className={expanded === annotation.id ? 'whitespace-pre-wrap break-words' : 'line-clamp-3 whitespace-pre-wrap break-words'}>{annotation.text}</span>
                  {annotation.note && <span className={expanded === annotation.id ? 'mt-2 block whitespace-pre-wrap break-words' : 'mt-2 line-clamp-3 whitespace-pre-wrap break-words'}>{annotation.note}</span>}
                </button>
                {annotation.type === 'note' && locationStatus !== 'source-unavailable' && <ContentImages images={annotation.images} />}
                {locationStatus === 'available' ? <a href={`/books/${encodeURIComponent(annotation.bookId)}?annotation=${encodeURIComponent(annotation.id)}`} className="mt-2 inline-block text-xs text-blue-600 underline dark:text-blue-400">{_('profileArchive.readLocation')}</a>
                  : <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{_(locationStatus === 'source-unavailable' ? 'profileArchive.sourceUnavailable' : 'profileArchive.positionUnavailable')}</p>}
              </article>
            ))}
          </div>
        ))}
      <ArchivePager page={page} hasMore={query.data?.data.hasMore ?? false} disabled={query.isFetching} onChange={(next) => onChange(next, bookId)} />
    </section>
  )
}
