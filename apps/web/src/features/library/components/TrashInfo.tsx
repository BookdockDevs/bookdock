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
  variant?: 'pill' | 'badge'
}

export default function TrashInfo({ book, className, variant = 'badge' }: TrashInfoProps) {
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

  const isPill = variant === 'pill'

  return (
    <p
      title={deletedLabel}
      className={cn(
        'inline-flex items-center gap-1 leading-tight select-none',
        isPill
          ? cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium shadow-xs backdrop-blur-md',
              warn
                ? 'border border-red-500/30 bg-red-600/90 text-white dark:border-red-400/30 dark:bg-red-700/90'
                : 'border border-white/20 bg-black/60 text-white dark:border-white/15 dark:bg-black/75 dark:text-stone-100',
            )
          : cn(
              'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              warn
                ? 'border border-red-200/70 bg-red-50/80 text-red-500 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400'
                : 'border border-stone-200/70 bg-stone-100/70 text-stone-500 dark:border-stone-700/60 dark:bg-stone-800/60 dark:text-stone-400',
            ),
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span className="truncate">{text}</span>
    </p>
  )
}
