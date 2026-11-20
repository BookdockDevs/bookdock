import { useEffect, useRef, type ReactNode } from 'react'

import { useUiStore } from '@/stores/ui.store'

import { markEscConsumed } from '../lib/esc-consumed'

interface SettingsPopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  toggleSelector?: string
}

export function SettingsPopover({ open, onClose, children, toggleSelector = '[data-settings-toggle]' }: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const trial = useUiStore((state) => state.readerThemeTrial !== null)

  useEffect(() => {
    if (!open || trial) return
    function handleClickCapture(e: MouseEvent) {
      // Ignore clicks inside the popover
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element).closest?.('[data-reader-selection-toolbar]')) return
      // Ignore clicks on the settings toggle button (avoids double-toggle)
      if ((e.target as HTMLElement).closest(toggleSelector)) return
      // Ignore clicks on floating context menus (SmartMenu) — they are portaled
      // to body to escape transforms, so they live outside the popover DOM
      if ((e.target as HTMLElement).closest('#preset-context-menu, [data-smart-menu]')) return
      // Toasts (with undo/dismiss actions) are portaled to body and are not part
      // of the reader surface; acting on one must not dismiss the panel — the
      // header collapses with it, which reads as the click "taking everything down".
      if ((e.target as HTMLElement).closest('[data-toast-id]')) return
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
  }, [open, onClose, toggleSelector, trial])

  if (!open) return null

  return (
    <div
      ref={ref}
      style={trial ? { visibility: 'hidden' } : { backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)', borderColor: 'var(--bd-read-accent)' }}
      className="pointer-events-auto fixed right-3 top-14 z-50 max-h-[min(34rem,calc(100dvh-4.5rem))] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] overscroll-contain rounded-xl border shadow-xl animate-modal-panel origin-top-right sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:max-h-[min(44rem,calc(100dvh-5rem))] sm:w-80"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
