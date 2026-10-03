import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'

import { Button } from './Button'
import { useDialogLayout } from './dialog-layout-context'

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  warning?: ReactNode
  icon?: ReactNode
  confirmLabel: string
  confirmVariant?: 'danger' | 'primary'
  confirmDisabled?: boolean
  confirmationText?: string
  confirmationLabel?: string
  errorFallback?: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shared confirmation surface for destructive and reversible actions. */
export default function ConfirmDialog({
  title,
  message,
  warning,
  icon,
  confirmLabel,
  confirmVariant = 'danger',
  confirmDisabled,
  confirmationText,
  confirmationLabel,
  errorFallback,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const _ = useTranslation()
  const dialogLayout = useDialogLayout()
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const messageId = `${dialogId}-message`
  const inputId = `${dialogId}-input`
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const needsText = confirmationText !== undefined
  const disabled = confirmDisabled || submitting || (needsText && (input === '' || input !== confirmationText))

  function close() {
    if (!submittingRef.current) closeRef.current()
  }

  async function confirm() {
    if (disabled || submittingRef.current) return
    if (!needsText) {
      onConfirm()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(getUserErrorMessage(err, _, errorFallback))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
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
        if (!submittingRef.current) closeRef.current()
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

        if (!dialogRef.current.contains(document.activeElement)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first)?.focus()
          return
        }

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
  }, [])

  return createPortal(
    <div
      data-settings-toggle=""
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4 ${dialogLayout.className} animate-modal-backdrop`}
      style={dialogLayout.style}
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-busy={submitting || undefined}
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
            {icon ?? (confirmVariant === 'danger' ? <WarningIcon /> : <RestoreIcon />)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {title}
            </h2>
            <div id={messageId} className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
              {message}
            </div>
            {warning && (
              <div className="mt-2.5 rounded-lg border border-amber-200/70 bg-amber-50/70 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                {warning}
              </div>
            )}
          </div>
        </div>
        {needsText && (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm text-stone-700 dark:text-stone-200">
              {confirmationLabel}
            </label>
            <p className="whitespace-pre-wrap break-all text-sm font-semibold text-stone-900 dark:text-stone-100">{confirmationText}</p>
            <input
              id={inputId}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={submitting}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={close} disabled={submitting} autoFocus={!needsText}>
            {_('library.cancel')}
          </Button>
          <Button type="button" variant={confirmVariant} size="sm" onClick={() => { void confirm() }} disabled={disabled}>
            {submitting ? _('library.confirmSubmitting') : confirmLabel}
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
