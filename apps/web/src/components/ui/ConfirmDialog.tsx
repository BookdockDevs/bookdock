import { useEffect } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { Button } from './Button'

interface ConfirmDialogProps {
  message: string
  /** Primary action label; defaults to a danger-styled 删除 */
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}

/** Styled replacement for window.confirm — same blocking semantics (nothing
 *  else can be clicked while it is open), no browser chrome. */
export default function ConfirmDialog({ message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const _ = useTranslation()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm leading-relaxed text-stone-700 dark:text-stone-200">{message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} className="bg-red-600 text-white hover:bg-red-500 dark:bg-red-600 dark:hover:bg-red-500">
            {confirmLabel ?? _('settings.fontsDelete')}
          </Button>
        </div>
      </div>
    </div>
  )
}
