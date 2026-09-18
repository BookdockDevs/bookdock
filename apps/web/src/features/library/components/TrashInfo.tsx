import { useQuery } from '@tanstack/react-query'

import type { BookListItem, SettingsRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_REMAINING_DAYS = 3

interface TrashInfoProps {
  book: BookListItem
  className?: string
}

export default function TrashInfo({ book, className }: TrashInfoProps) {
  const _ = useTranslation()
  // One shared ['settings'] query (seeded by SettingsSync); cards only mount in the trash view
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<{ data: SettingsRes }>('/settings'),
  })
  if (!book.deletedAt) return null

  const autoCleanDays = settingsQuery.data?.data.trash?.autoCleanDays ?? 30
  const daysSince = Math.max(0, Math.floor((Date.now() - book.deletedAt) / DAY_MS))
  // Only the actionable number stays inline; deleted-days moves to the tooltip
  const deletedLabel = _('library.trashDeletedDays', { days: daysSince })
  let text = deletedLabel
  let warn = false
  if (autoCleanDays > 0) {
    const remaining = autoCleanDays - daysSince
    if (remaining <= 0) {
      text = _('library.trashPurgeSoon')
      warn = true
    } else {
      text = _('library.trashPurgeInDays', { days: remaining })
      warn = remaining <= WARN_REMAINING_DAYS
    }
  }

  return (
    <p title={deletedLabel} className={cn('truncate text-xs', warn ? 'text-red-500 dark:text-red-400' : 'text-stone-400 dark:text-stone-500', className)}>
      {text}
    </p>
  )
}
