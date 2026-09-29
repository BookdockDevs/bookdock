import { useTranslation } from '@/hooks/useTranslation'

interface HiddenIndicatorProps {
  kind: 'work' | 'versions' | 'private'
  /**
   * On-cover badge: same dark pill as the pin/menu affordances
   * (h-7 rounded-full bg-black/45 white icon). Inline elsewhere: a bare icon
   * with no background block.
   */
  overlay?: boolean
}

export default function HiddenIndicator({ kind, overlay = false }: HiddenIndicatorProps) {
  const _ = useTranslation()
  const label = kind === 'versions'
    ? _('library.hiddenVersionsStatus')
    : kind === 'private' ? _('library.hiddenPrivateStatus') : _('library.hiddenWorkStatus')

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={overlay
        ? 'inline-flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm'
        : 'inline-flex h-4 w-4 shrink-0 items-center justify-center text-stone-400 dark:text-stone-500'}
    >
      <svg width={overlay ? 14 : 12} height={overlay ? 14 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind !== 'versions' ? (
          <>
            <path d="M10.7 5.1A11 11 0 0 1 12 5c7 0 10 7 10 7a13.3 13.3 0 0 1-3.1 4" />
            <path d="M6.2 6.2C3.5 8 2 12 2 12s3 7 10 7a10.5 10.5 0 0 0 4.2-.8" />
            <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
          </>
        ) : (
          <>
            <rect x="7" y="6" width="14" height="16" rx="2" />
            <path d="M4 18H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v1M10 9l8 8" />
          </>
        )}
      </svg>
    </span>
  )
}
