import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes, formatDate } from '@/lib/utils'
import { LIST_INFO_ITEMS, useUiStore } from '@/stores/ui.store'

import { formatRelativeTime } from '@/features/reader/components/format-relative-time'

interface ListItemInfoProps {
  book: BookListItem
}

export default function ListItemInfo({ book }: ListItemInfoProps) {
  const _ = useTranslation()
  const listInfoItems = useUiStore((s) => s.listInfoItems)

  const parts: string[] = []
  for (const item of LIST_INFO_ITEMS) {
    if (!listInfoItems.includes(item)) continue
    if (item === 'progress' && book.progress != null && book.progress > 0) {
      parts.push(_('library.listInfoProgress', { n: Math.round(book.progress) }))
    } else if (item === 'size') {
      parts.push(formatBytes(book.size))
    } else if (item === 'lastRead' && book.lastReadAt) {
      parts.push(formatRelativeTime(_, book.lastReadAt))
    } else if (item === 'shelf') {
      parts.push(book.shelfName ?? _('library.uncategorized'))
    } else if (item === 'tags' && book.tags && book.tags.length > 0) {
      parts.push(book.tags.join('、'))
    } else if (item === 'createdAt') {
      parts.push(formatDate(book.createdAt))
    }
  }
  if (parts.length === 0) return null

  return (
    <div className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-stone-400 dark:text-stone-500 md:flex">
      {parts.map((part, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="shrink-0 text-stone-300 dark:text-stone-600">·</span>}
          <span className="max-w-32 truncate">{part}</span>
        </span>
      ))}
    </div>
  )
}
