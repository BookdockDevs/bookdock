import { cn } from '@/lib/utils'

interface LocalStorageBadgeProps {
  className?: string
}

export default function LocalStorageBadge({ className }: LocalStorageBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[28px] items-center justify-center rounded border border-stone-200/70 bg-stone-100 px-1 text-stone-600 dark:border-stone-700/70 dark:bg-stone-800 dark:text-stone-400',
        className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    </span>
  )
}
