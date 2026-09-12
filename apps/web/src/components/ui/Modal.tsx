import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

interface ModalProps {
  title: string
  onClose: () => void
  /** Extra header actions between the title and the close button */
  actions?: ReactNode
  /** Spread onto the backdrop (e.g. the settings-popover ignore flag) */
  containerProps?: HTMLAttributes<HTMLDivElement> & Record<string, string | undefined>
  variant?: 'default' | 'reader'
  size?: 'sm' | 'default' | 'wide'
  children: ReactNode
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The project's centered modal chrome — every dialog (transforms manager,
 *  per-book rules, selection replace) shares this shell so they read as one
 *  window system. The close button is always the X: hosts may give it
 *  "back" semantics (e.g. cancel an inline edit view) via onClose. */
export default function Modal({
  title,
  onClose,
  actions,
  containerProps,
  variant = 'default',
  size = 'default',
  children,
}: ModalProps) {
  const _ = useTranslation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const reader = variant === 'reader'
  const width = size === 'wide' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg'
  const btn = reader
    ? 'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-[var(--bd-read-text)]'
    : 'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      const autoFocusEl = dialog.querySelector<HTMLElement>('[autofocus]')
      if (autoFocusEl) {
        autoFocusEl.focus()
      } else if (focusable.length > 0) {
        focusable[0]?.focus()
      } else {
        dialog.focus()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const alertDialog = document.querySelector<HTMLElement>('[role="alertdialog"][aria-modal="true"]')
      if (alertDialog && !dialogRef.current?.contains(alertDialog)) return
      const smartMenu = document.querySelector<HTMLElement>('[data-smart-menu="true"]')
      if (smartMenu && dialogRef.current?.contains(smartMenu)) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        onCloseRef.current()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
        if (!dialogRef.current.contains(document.activeElement)) return
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    }

    const previousActiveElement = previousActiveElementRef.current

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus()
      }
    }
  }, [])

  return (
    <div
      {...containerProps}
      className={`fixed inset-0 z-50 flex items-end justify-center overscroll-none bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4 animate-modal-backdrop ${containerProps?.className ?? ''}`.trim()}
      onClick={onClose}
      onWheel={(event) => { if (event.target === event.currentTarget) event.preventDefault() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1rem)] w-full ${width} flex-col overflow-hidden rounded-t-2xl shadow-xl outline-none sm:max-h-[85vh] sm:rounded-2xl ${reader ? 'bg-[var(--bd-read-bg)] text-[var(--bd-read-text)]' : 'bg-white dark:bg-stone-900'} animate-modal-panel`}
        onClick={(e) => e.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className={`flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-5 ${reader ? 'border-[var(--bd-read-accent)]' : 'border-stone-100 dark:border-stone-800'}`}>
          <h2 id={titleId} className={`truncate text-base font-semibold ${reader ? 'text-[var(--bd-read-text)]' : 'text-stone-900 dark:text-stone-100'}`}>{title}</h2>
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
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-5">{children}</div>
      </div>
    </div>
  )
}
