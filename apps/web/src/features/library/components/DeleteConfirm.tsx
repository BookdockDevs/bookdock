import { useEffect, type ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { t } from '@/i18n'

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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {title ?? '删除书籍'}
        </h2>
        <p className="mb-6 text-sm text-stone-500">
          {message ?? (
            <>
              确定要删除「<span className="inline-block max-w-full truncate align-bottom text-stone-700 dark:text-stone-200">{bookTitle ?? ''}</span>」吗？
            </>
          )}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t().library.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel ?? '删除'}
          </Button>
        </div>
      </div>
    </div>
  )
}
