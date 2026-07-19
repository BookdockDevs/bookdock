import { useEffect, useRef, type ReactNode } from 'react'

interface SettingsPopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function SettingsPopover({ open, onClose, children }: SettingsPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickCapture(e: MouseEvent) {
      // Ignore clicks inside the popover
      if (ref.current?.contains(e.target as Node)) return
      // Ignore clicks on the settings toggle button (avoids double-toggle)
      if ((e.target as HTMLElement).closest('[data-settings-toggle]')) return
      onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleClickCapture, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClickCapture, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute right-0 top-full z-50 mt-4 w-80 max-h-[80vh] overflow-y-auto rounded-lg border shadow-2xl"
      style={{ backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)', borderColor: 'var(--bd-read-accent)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
