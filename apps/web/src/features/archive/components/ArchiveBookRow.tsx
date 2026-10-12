import { Link } from '@tanstack/react-router'

import type { ArchiveBookItem } from '@bookdock/shared'

import BookCover from '@/features/library/components/BookCover'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'

import type { ArchiveSearch } from '@/routes/archive'

import { formatCounts, readStatusLabel } from './archive-helpers'

export default function ArchiveBookRow({ book, to, onOpen }: { book: ArchiveBookItem; to: { to: '/archive'; search: ArchiveSearch }; onOpen?: () => void }) {
  const _ = useTranslation()
  const counts = formatCounts(book, _)
  return (
    <Link
      to={to.to}
      search={to.search}
      onClick={onOpen}
      className="flex items-center gap-4 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 focus-visible:ring-offset-2 dark:focus-visible:ring-stone-500/60 dark:focus-visible:ring-offset-stone-950"
    >
      <BookCover book={{ id: book.bookVersionId, title: book.title ?? '', format: book.format, coverKey: book.coverKey }} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-stone-900 dark:text-stone-100">
          {book.title ?? _('review.sourceGoneTitle')}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] text-stone-600 dark:text-stone-300">
          <span className="truncate font-medium tabular-nums">{counts}</span>
          {book.lastRecordAt != null && (
            <>
              <span aria-hidden="true"> · </span>
              <time dateTime={new Date(book.lastRecordAt).toISOString()} title={formatFullDateTime(_, book.lastRecordAt)}>
                {formatRelativeTime(_, book.lastRecordAt)}
              </time>
            </>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-stone-400 dark:text-stone-500">
          {readStatusLabel(book.readStatus, _)}
        </span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  )
}
