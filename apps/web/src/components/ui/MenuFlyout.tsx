import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// A menu row whose hover/click opens a flyout panel to the right, flipping to
// the left when the viewport is tight. Extracted from the context menu's
// status flyout; reused by the detail dialog's download menu.
interface MenuFlyoutProps {
  row: (state: { open: boolean; toggle: () => void; flip: boolean }) => ReactNode
  children: (close: () => void) => ReactNode
  panelWidth?: number
}

export default function MenuFlyout({ row, children, panelWidth = 144 }: MenuFlyoutProps) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (rect) setFlip(rect.right > window.innerWidth - 8)
  }, [open])

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {row({ open, flip, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className={`absolute top-0 z-10 ${flip ? 'right-full pr-1.5' : 'left-full pl-1.5'}`}>
          <div
            ref={panelRef}
            style={{ width: panelWidth }}
            className="rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
          >
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </div>
  )
}
