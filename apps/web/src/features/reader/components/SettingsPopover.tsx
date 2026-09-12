import { useEffect, useRef, type ReactNode } from 'react'

import { markEscConsumed } from '../lib/esc-consumed'

interface SettingsPopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  toggleSelector?: string
}

export function SettingsPopover({ open, onClose, children, toggleSelector = '[data-settings-toggle]' }: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickCapture(e: MouseEvent) {
      // Ignore clicks inside the popover
      if (ref.current?.contains(e.target as Node)) return
      // Ignore clicks on the settings toggle button (avoids double-toggle)
      if ((e.target as HTMLElement).closest(toggleSelector)) return
      // Ignore clicks on the preset context menu — it is portaled to body to
      // escape this header's transform, so it lives outside the popover DOM
      if ((e.target as HTMLElement).closest('#preset-context-menu')) return
      onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        onClose()
      }
    }
    document.addEventListener('click', handleClickCapture, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClickCapture, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose, toggleSelector])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed right-3 top-14 z-50 max-h-[min(34rem,calc(100dvh-4.5rem))] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] overscroll-contain rounded-xl border shadow-2xl animate-modal-panel origin-top-right sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:max-h-[min(44rem,calc(100dvh-5rem))] sm:w-80"
      style={{ backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)', borderColor: 'var(--bd-read-accent)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
