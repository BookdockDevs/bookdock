import { Link } from '@tanstack/react-router'

import type { ArchiveBookItem } from '@bookdock/shared'

import BookCover from '@/features/library/components/BookCover'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import type { ArchiveSearch } from '@/routes/archive'

import { archiveCountParts, readStatusLabel } from './archive-helpers'

export default function ArchiveBookRow({
  book,
  to,
  onOpen,
  selected = false,
}: {
  book: ArchiveBookItem
  to: { to: '/archive'; search: ArchiveSearch }
  onOpen?: () => void
  selected?: boolean
}) {
  const _ = useTranslation()
  const parts = archiveCountParts(book, _)
  return (
    <Link
      to={to.to}
      search={to.search}
      // Forward history state (the recorded archive exit source); a Link
      // without state resets it.
      state={(previous) => ({ ...previous })}
      onClick={onOpen}
      className={cn(
        'group flex items-center gap-3 rounded-xl p-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60',
        selected
          ? 'bg-stone-200/70 text-stone-950 shadow-2xs ring-1 ring-stone-900/5 dark:bg-stone-800 dark:text-stone-50 dark:ring-white/5'
          : 'text-stone-700 hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/60 dark:hover:text-stone-100',
      )}
    >
      <div className="shrink-0">
        <BookCover book={{ id: book.bookVersionId, title: book.title ?? '', format: book.format, coverKey: book.coverKey }} size="sm" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h3 className="truncate text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {book.title ?? _('review.sourceGoneTitle')}
        </h3>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 truncate">
          {parts.map((part, index) => (
            <span key={part.key} className="inline-flex items-center gap-1 shrink-0">
              {index > 0 && <span className="text-stone-300 dark:text-stone-600">·</span>}
              <span>
                {part.label} <span className="font-semibold tabular-nums text-stone-700 dark:text-stone-300">{part.value}</span>
              </span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
          <span>{readStatusLabel(book.readStatus, _)}</span>
          {book.lastRecordAt != null && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(book.lastRecordAt).toISOString()} title={formatFullDateTime(_, book.lastRecordAt)}>
                {formatRelativeTime(_, book.lastRecordAt)}
              </time>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
