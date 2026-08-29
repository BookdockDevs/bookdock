import type { HTMLAttributes, ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

interface ModalProps {
  title: string
  onClose: () => void
  /** Extra header actions between the title and the close button */
  actions?: ReactNode
  /** Spread onto the backdrop (e.g. the settings-popover ignore flag) */
  containerProps?: HTMLAttributes<HTMLDivElement> & Record<string, string | undefined>
  variant?: 'default' | 'reader'
  children: ReactNode
}

/** The project's centered modal chrome — every dialog (transforms manager,
 *  per-book rules, selection replace) shares this shell so they read as one
 *  window system. The close button is always the X: hosts may give it
 *  "back" semantics (e.g. cancel an inline edit view) via onClose. */
export default function Modal({ title, onClose, actions, containerProps, variant = 'default', children }: ModalProps) {
  const _ = useTranslation()
  const reader = variant === 'reader'
  const btn = reader
    ? 'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-[var(--bd-read-text)]'
    : 'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <div
      {...containerProps}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl shadow-xl sm:max-h-[85vh] sm:rounded-2xl ${reader ? 'bg-[var(--bd-read-bg)] text-[var(--bd-read-text)]' : 'bg-white dark:bg-stone-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-5 ${reader ? 'border-[var(--bd-read-accent)]' : 'border-stone-100 dark:border-stone-800'}`}>
          <h2 className={`truncate text-base font-semibold ${reader ? 'text-[var(--bd-read-text)]' : 'text-stone-900 dark:text-stone-100'}`}>{title}</h2>
          <div className="flex items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={_('library.cancel')}
              title={_('library.cancel')}
              className={btn}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  )
}
