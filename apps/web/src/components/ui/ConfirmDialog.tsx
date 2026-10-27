import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

import { Button } from './Button'
import { useDialogLayout } from './dialog-layout-context'

export interface ConfirmDialogProps {
  title: ReactNode
  message: ReactNode
  warning?: ReactNode
  icon?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  footerLeading?: ReactNode
  dismissible?: boolean
  confirmVariant?: 'danger' | 'primary'
  confirmDisabled?: boolean
  confirmationText?: string
  confirmationLabel?: string
  errorFallback?: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

let activeConfirmCount = 0
let savedBodyOverflow = ''

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shared confirmation surface for destructive, reversible, and verified actions. */
export default function ConfirmDialog({
  title,
  message,
  warning,
  icon,
  confirmLabel,
  cancelLabel,
  footerLeading,
  dismissible = true,
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
    if (dismissible && !submittingRef.current) closeRef.current()
  }

  async function confirm() {
    if (disabled || submittingRef.current) return
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
    if (activeConfirmCount === 0) {
      savedBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    activeConfirmCount += 1

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (dismissible && !submittingRef.current) closeRef.current()
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
      activeConfirmCount = Math.max(0, activeConfirmCount - 1)
      if (activeConfirmCount === 0) {
        document.body.style.overflow = savedBodyOverflow
      }
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus()
      }
    }
  }, [dismissible])

  return createPortal(
    <div
      data-settings-toggle=""
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-xs overscroll-none sm:items-center sm:p-4 animate-modal-backdrop',
        dialogLayout.className,
      )}
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
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-stone-200/90 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl dark:border-stone-800 dark:bg-stone-900 animate-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                confirmVariant === 'danger'
                  ? 'bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                  : 'bg-stone-500/10 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300',
              )}
              aria-hidden="true"
            >
              {icon ?? (confirmVariant === 'danger' ? <WarningIcon /> : <RestoreIcon />)}
            </div>
            <h2 id={titleId} className="truncate text-base font-semibold text-stone-900 dark:text-stone-100 tracking-tight">
              {title}
            </h2>
          </div>
          {dismissible && <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label={_('library.close')}
            title={_('library.close')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] px-5 py-4 space-y-3.5 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
          <div id={messageId}>
            {message}
          </div>
          {warning && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-200">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">{warning}</div>
            </div>
          )}
          {needsText && (
            <div className="flex flex-col gap-2 rounded-xl border border-stone-200/80 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
              <label htmlFor={inputId} className="text-xs font-medium text-stone-700 dark:text-stone-300">
                {confirmationLabel}
              </label>
              <div className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-stone-900 select-all dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 break-all">
                {confirmationText}
              </div>
              <input
                id={inputId}
                aria-label={confirmationLabel}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !disabled) {
                    e.preventDefault()
                    void confirm()
                  }
                }}
                disabled={submitting}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400/20 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:ring-stone-500/20 transition-all"
                placeholder={typeof confirmationText === 'string' ? confirmationText : undefined}
              />
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-600 dark:border-red-500/30 dark:text-red-400">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-stone-100 bg-stone-50/50 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-stone-800 dark:bg-stone-900/60">
          {footerLeading}
          {dismissible && <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={close}
            disabled={submitting}
            autoFocus={!needsText}
            className="h-9 px-4 text-xs sm:text-sm"
          >
            {cancelLabel ?? _('library.cancel')}
          </Button>}
          <Button
            type="button"
            variant={confirmVariant}
            size="md"
            onClick={() => { void confirm() }}
            disabled={disabled}
            className="h-9 px-4 text-xs sm:text-sm inline-flex items-center gap-1.5"
          >
            {submitting && (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            <span>{submitting ? _('library.confirmSubmitting') : confirmLabel}</span>
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function WarningIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
