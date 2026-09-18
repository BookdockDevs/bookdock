import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'

interface DeleteConfirmProps {
  open: boolean
  bookTitle?: string
  title?: string
  message?: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirm({ open, bookTitle, title, message, confirmLabel, onConfirm, onCancel }: DeleteConfirmProps) {
  const _ = useTranslation()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  // Chinese TXT uploads often take their title straight from the filename and
  // already carry 《》; wrapping those in 「」 too reads as 「《x》」.
  const bareTitle = (bookTitle ?? '').startsWith('《')

  // Portaled to body so the fixed overlay escapes the sticky sidebar's
  // stacking context (same reason as Modal/SmartMenu).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-none sm:overflow-visible sm:rounded-2xl sm:p-6 dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {title ?? _('library.deleteBook')}
        </h2>
        <p className="mb-6 text-sm text-stone-500">
          {message ?? _(bareTitle ? 'library.deleteConfirmBare' : 'library.deleteConfirm', { title: bookTitle ?? '' })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {_('library.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel ?? _('library.delete')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
