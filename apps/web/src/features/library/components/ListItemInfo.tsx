import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { LIST_INFO_ITEMS, useUiStore } from '@/stores/ui.store'

import { formatRelativeTime } from '@/features/reader/components/format-relative-time'

interface ListItemInfoProps {
  book: BookListItem
}

interface InfoPart {
  key: string
  text: string
  className?: string
}

export default function ListItemInfo({ book }: ListItemInfoProps) {
  const _ = useTranslation()
  const listInfoItems = useUiStore((s) => s.listInfoItems)

  const parts: InfoPart[] = []
  for (const item of LIST_INFO_ITEMS) {
    if (!listInfoItems.includes(item)) continue
    if (item === 'progress' && book.progress != null && book.progress > 0) {
      parts.push({
        key: 'progress',
        text: _('library.listInfoProgress', { n: Math.min(100, Math.round(book.progress)) }),
        className: 'font-mono font-medium text-stone-600 dark:text-stone-300',
      })
    } else if (item === 'lastRead' && book.lastReadAt) {
      parts.push({ key: 'lastRead', text: formatRelativeTime(_, book.lastReadAt) })
    } else if (item === 'shelf' && book.shelfName) {
      parts.push({ key: 'shelf', text: book.shelfName })
    } else if (item === 'tags' && book.tags && book.tags.length > 0) {
      parts.push({ key: 'tags', text: book.tags.join('、') })
    } else if (item === 'size') {
      parts.push({ key: 'size', text: formatBytes(book.size) })
    } else if (item === 'createdAt') {
      parts.push({ key: 'createdAt', text: formatDate(book.createdAt) })
    }
  }
  if (parts.length === 0) return null

  return (
    <div className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-stone-400 dark:text-stone-500 md:flex">
      {parts.map((part, i) => (
        <span key={part.key} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="shrink-0 text-stone-300 dark:text-stone-600">·</span>}
          <span className={cn('max-w-32 truncate', part.className)}>{part.text}</span>
        </span>
      ))}
    </div>
  )
}
