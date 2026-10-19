import { Link } from '@tanstack/react-router'
import { parseArchiveRecordTypes, type ArchiveBookItem } from '@bookdock/shared'

import BookCover from '@/features/library/components/BookCover'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import type { ArchiveSearch } from '@/routes/archive'

import { readStatusLabel } from './archive-helpers'

function getArchiveMetricsParts(
  book: ArchiveBookItem,
  activeType: string | undefined,
  t: (key: string, options?: Record<string, string | number>) => string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = []

  // 1. 阅读时长或天数
  if (book.durationSeconds != null && book.durationSeconds > 0) {
    const formatted = formatDuration(book.durationSeconds, t)
    parts.push(
      <span key="duration" className="tabular-nums">
        {t('archive.readingDuration', { time: formatted, defaultValue: `阅读 ${formatted}` })}
      </span>,
    )
  } else if (book.readingDays != null && book.readingDays > 0) {
    parts.push(
      <span key="days" className="tabular-nums">
        {t('stats.bookDays', { n: book.readingDays, defaultValue: `共读 ${book.readingDays} 天` })}
      </span>,
    )
  }

  // 2. 阅读进度
  if (book.progress != null && book.progress > 0) {
    parts.push(
      <span key="progress" className="tabular-nums font-mono">
        {Math.round(book.progress)}%
      </span>,
    )
  }

  // 3. 笔记统计 (按当前筛选的分类或总计)
  const selectedTypes = parseArchiveRecordTypes(activeType)
  if (selectedTypes.length === 1) {
    const singleType = selectedTypes[0]!
    const count =
      singleType === 'highlight'
        ? book.highlights
        : singleType === 'bookmark'
          ? book.bookmarks
          : singleType === 'idea'
            ? book.ideas
            : book.reviews
    if (count > 0) {
      const label =
        singleType === 'highlight'
          ? t('archive.highlightCountCompact', { n: count, defaultValue: `划线 ${count}` })
          : singleType === 'bookmark'
            ? t('archive.bookmarkCountCompact', { n: count, defaultValue: `书签 ${count}` })
            : singleType === 'idea'
              ? t('archive.ideaCountCompact', { n: count, defaultValue: `想法 ${count}` })
              : t('archive.reviewCountCompact', { n: count, defaultValue: `书评 ${count}` })
      parts.push(
        <span key="notes" className="tabular-nums">
          {label}
        </span>,
      )
    }
  } else if (selectedTypes.length > 1) {
    const sumCount = selectedTypes.reduce((sum, tType) => {
      const field = tType === 'review' ? 'reviews' : tType === 'idea' ? 'ideas' : tType === 'bookmark' ? 'bookmarks' : 'highlights'
      return sum + book[field]
    }, 0)
    if (sumCount > 0) {
      parts.push(
        <span key="notes" className="tabular-nums">
          {t('archive.noteCountCompact', { n: sumCount, defaultValue: `笔记 ${sumCount}` })}
        </span>,
      )
    }
  } else if (book.total > 0) {
    parts.push(
      <span key="notes" className="tabular-nums">
        {t('archive.noteCountCompact', { n: book.total, defaultValue: `笔记 ${book.total}` })}
      </span>,
    )
  }

  // 4. 若上述指标皆为空（如刚添加未读的书），回退显示阅读状态
  if (parts.length === 0) {
    parts.push(
      <span key="status">
        {readStatusLabel(book.readStatus, t)}
      </span>,
    )
  }

  return parts
}

export interface ArchiveBookRowProps {
  book: ArchiveBookItem
  to: { to: '/archive'; search: ArchiveSearch }
  onOpen?: () => void
  selected?: boolean
  activeType?: string
}

export default function ArchiveBookRow({
  book,
  to,
  onOpen,
  selected = false,
  activeType,
}: ArchiveBookRowProps) {
  const _ = useTranslation()
  const metricsParts = getArchiveMetricsParts(book, activeType, _)

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
      <div className="shrink-0" aria-hidden="true">
        <BookCover
          book={{ id: book.bookVersionId, title: book.title ?? '', format: book.format, coverKey: book.coverKey }}
          size="sm"
        />
      </div>
      <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
        {/* Row 1: 书名 */}
        <h3 className="truncate text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {book.title ?? _('review.sourceGoneTitle')}
        </h3>

        {/* Row 2: 作者 */}
        <p className="truncate text-xs text-stone-500 dark:text-stone-400">
          {book.author || _('archive.unknownAuthor', { defaultValue: '未知作者' })}
        </p>

        {/* Row 3: 核心阅读数据流 (如: 阅读 4 分钟 · 47% · 笔记 3) */}
        <div className="flex items-center gap-1.5 truncate text-xs text-stone-400 dark:text-stone-500">
          {metricsParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1.5 truncate">
              {i > 0 && <span className="shrink-0 text-stone-300 dark:text-stone-600">·</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
