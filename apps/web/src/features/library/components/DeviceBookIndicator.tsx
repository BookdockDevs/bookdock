import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface DeviceBookIndicatorProps {
  /** On-cover badge matching other cover affordances; false renders an inline list icon. */
  overlay?: boolean
  menuOpen?: boolean
}

export default function DeviceBookIndicator({ overlay = false, menuOpen = false }: DeviceBookIndicatorProps) {
  const _ = useTranslation()
  const label = _('library.bookSourceLocal')

  return (
    <span
      role="img"
      aria-label={label}
      title={_('library.deviceBookHint')}
      className={cn(
        'inline-flex shrink-0 cursor-default items-center justify-center opacity-100 transition-opacity duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
        menuOpen ? 'md:opacity-100' : 'md:opacity-0',
        overlay
          ? 'h-7 w-7 rounded-full bg-black/45 text-white backdrop-blur-sm'
          : 'h-4 w-4 text-stone-400 dark:text-stone-500',
      )}
    >
      <svg
        width={overlay ? 13 : 12}
        height={overlay ? 13 : 12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    </span>
  )
}
