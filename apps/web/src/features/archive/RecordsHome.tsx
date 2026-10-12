import { Link } from '@tanstack/react-router'

import type { ArchiveRecordType } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { BookmarkIcon, BulbIcon, ChatBubbleIcon, QuoteIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'

import type { ArchiveSearch } from '@/routes/archive'

import { useArchiveOverview } from './hooks'
import ArchiveBookRow from './components/ArchiveBookRow'

export default function RecordsHome({ baseSearch, onOpenChild }: { baseSearch: ArchiveSearch; onOpenChild: () => void }) {
  const _ = useTranslation()
  const overview = useArchiveOverview()

  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-6" role="status" aria-label={_('archive.loading')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-500/10" />)}
        </div>
        <div className="h-48 animate-pulse rounded-2xl bg-stone-500/10" />
      </div>
    )
  }
  if (overview.isError) {
    return <QueryErrorState isRetrying={overview.isFetching} onRetry={() => void overview.refetch()} />
  }

  const counts = overview.data.data.counts
  const cards: Array<{ type: ArchiveRecordType; label: string; value: number; icon: React.ReactNode }> = [
    { type: 'highlight', label: _('archive.highlights'), value: counts.highlights, icon: <QuoteIcon size={20} /> },
    { type: 'bookmark', label: _('archive.bookmarks'), value: counts.bookmarks, icon: <BookmarkIcon /> },
    { type: 'idea', label: _('archive.ideas'), value: counts.ideas, icon: <BulbIcon size={20} /> },
    { type: 'review', label: _('archive.reviews'), value: counts.reviews, icon: <ChatBubbleIcon size={20} /> },
  ]
  const recent = overview.data.data.recent

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label={_('archive.overview')}>
        {cards.map((card) => (
          <Link
            key={card.type}
            to="/archive"
            search={{ ...baseSearch, view: 'all', type: card.type, page: 1 }}
            onClick={onOpenChild}
            role="listitem"
            className="group flex min-w-0 items-center gap-3 rounded-xl border border-stone-200/70 bg-stone-100/70 px-3.5 py-3 transition-colors hover:border-stone-300 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 focus-visible:ring-offset-2 dark:border-stone-800/70 dark:bg-stone-900/60 dark:hover:border-stone-700 dark:hover:bg-stone-900 dark:focus-visible:ring-stone-500/60 dark:focus-visible:ring-offset-stone-950"
          >
            <span className="shrink-0 text-stone-500 dark:text-stone-400">{card.icon}</span>
            <span className="min-w-0">
              <span className="block text-2xl font-semibold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">{card.value}</span>
              <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{card.label}</span>
            </span>
          </Link>
        ))}
      </div>

      <section aria-label={_('archive.recentBooks')}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">{_('archive.recentBooks')}</h2>
          <Link
            to="/archive"
            search={{ ...baseSearch, view: 'all' }}
            onClick={onOpenChild}
            className="group inline-flex items-center gap-1 text-sm text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <span>{_('archive.viewAll')}</span>
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">{_('archive.noRecords')}</p>
        ) : (
          <div className="divide-y divide-stone-200/70 dark:divide-stone-800/70">
            {recent.map((book) => (
              <ArchiveBookRow key={book.bookVersionId} book={book} onOpen={onOpenChild} to={{ to: '/archive', search: { ...baseSearch, view: 'book', bookId: book.bookVersionId, from: 'home' } }} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
