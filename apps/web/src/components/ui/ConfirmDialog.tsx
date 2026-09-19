import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '@/hooks/useTranslation'

import { Button } from './Button'

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  warning?: ReactNode
  confirmLabel: string
  confirmVariant?: 'danger' | 'primary'
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shared confirmation surface for destructive and reversible actions. */
export default function ConfirmDialog({
  title,
  message,
  warning,
  confirmLabel,
  confirmVariant = 'danger',
  confirmDisabled,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const _ = useTranslation()
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const messageId = `${dialogId}-message`
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        onClose()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
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
    window.addEventListener('keydown', onKey)
    const previousActiveElement = previousActiveElementRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus()
      }
    }
  }, [onClose])

  return createPortal(
    <div
      data-settings-toggle=""
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4 animate-modal-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col gap-5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-2xl dark:bg-stone-900 animate-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={
              confirmVariant === 'danger'
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
            }
            aria-hidden="true"
          >
            {confirmVariant === 'danger' ? <WarningIcon /> : <RestoreIcon />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {title}
            </h2>
            <div id={messageId} className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
              {message}
            </div>
            {warning && <div className="mt-2 text-xs text-amber-600 dark:text-amber-500">{warning}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} autoFocus>
            {_('library.cancel')}
          </Button>
          <Button type="button" variant={confirmVariant} size="sm" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.8 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 14-5-5 5-5" />
      <path d="M4 9h10.5A5.5 5.5 0 1 1 9 19H8" />
    </svg>
  )
}
