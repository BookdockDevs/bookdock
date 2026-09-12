import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { PADDING } from '@/lib/position'

// A menu row whose hover/click opens a flyout panel, adapting to the available
// viewport space. Extracted from the context menu's status flyout; reused by
// the detail dialog's download menu.
interface MenuFlyoutProps {
  row: (state: { open: boolean; toggle: () => void; flip: boolean }) => ReactNode
  children: (close: () => void) => ReactNode
  panelWidth?: number
}

export default function MenuFlyout({ row, children, panelWidth = 144 }: MenuFlyoutProps) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const [flipUp, setFlipUp] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return

    const updatePlacement = () => {
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      setFlip(rect.right > window.innerWidth - PADDING)
      setFlipUp(rect.bottom > window.innerHeight - PADDING)
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    return () => window.removeEventListener('resize', updatePlacement)
  }, [open])

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {row({ open, flip, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className={`absolute z-10 ${flipUp ? 'bottom-0' : 'top-0'} ${flip ? 'right-full pr-1.5' : 'left-full pl-1.5'}`}>
          <div
            ref={panelRef}
            style={{ width: panelWidth }}
            className="max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
          >
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </div>
  )
}
