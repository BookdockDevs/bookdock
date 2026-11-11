import type { LibraryVisibility } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

interface LibraryVisibilityFieldProps {
  value: LibraryVisibility
  onChange: (visibility: LibraryVisibility) => void
  name?: string
  labelClassName?: string
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

/**
 * Shared three-card visibility / join-mode selector for creating and managing a library.
 */
export default function LibraryVisibilityField({
  value,
  onChange,
  name = 'library-visibility',
  labelClassName = 'font-medium',
}: LibraryVisibilityFieldProps) {
  const _ = useTranslation()

  const visibilityOptions: Array<{
    value: LibraryVisibility
    icon: typeof LockIcon
    label: string
    hint: string
  }> = [
    {
      value: 'public',
      icon: GlobeIcon,
      label: _('library.visibilityPublic'),
      hint: _('library.visibilityHintPublic'),
    },
    {
      value: 'password',
      icon: KeyIcon,
      label: _('library.visibilityPassword'),
      hint: _('library.visibilityHintPassword'),
    },
    {
      value: 'private',
      icon: LockIcon,
      label: _('library.visibilityPrivate'),
      hint: _('library.visibilityHintPrivate'),
    },
  ]

  return (
    <div className="flex flex-col gap-2 text-sm text-stone-700 dark:text-stone-300">
      <span className={labelClassName}>{_('library.libraryVisibility')}</span>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {visibilityOptions.map((opt) => {
          const Icon = opt.icon
          const selected = value === opt.value
          return (
            <label
              key={opt.value}
              className={cn(
                'group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition-all select-none',
                selected
                  ? 'border-stone-900 bg-stone-50/70 shadow-xs ring-1 ring-stone-900 dark:border-stone-100 dark:bg-stone-800/60 dark:ring-stone-100'
                  : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50/40 dark:border-stone-700/80 dark:bg-stone-900/60 dark:hover:border-stone-600 dark:hover:bg-stone-800/40',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                aria-label={opt.label}
                className="sr-only"
              />
              <div>
                <div className="flex items-center justify-between">
                  <div className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                    selected
                      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                      : 'bg-stone-100 text-stone-500 group-hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:text-stone-200',
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border transition-colors',
                    selected
                      ? 'border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100'
                      : 'border-stone-300 group-hover:border-stone-400 dark:border-stone-600 dark:group-hover:border-stone-500',
                  )}>
                    {selected && <div className="h-1.5 w-1.5 rounded-full bg-white dark:bg-stone-900" />}
                  </div>
                </div>
                <span className="mt-2.5 block text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {opt.label}
                </span>
              </div>
              <span className="mt-1 block text-xs leading-relaxed text-stone-400 dark:text-stone-400">
                {opt.hint}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
