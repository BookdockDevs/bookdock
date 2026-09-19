import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!open) return

    const updatePlacement = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const triggerRect = trigger.getBoundingClientRect()
      const panel = panelRef.current
      const panelRect = panel?.getBoundingClientRect()
      const panelHeight = panelRect?.height || 160

      // Compute horizontal placement based on the stable trigger position:
      // If expanding right overflows viewport, flip left.
      const overflowsRight = triggerRect.right + panelWidth + PADDING > window.innerWidth
      const overflowsLeft = triggerRect.left - panelWidth - PADDING < 0
      setFlip(overflowsRight && (!overflowsLeft || triggerRect.left > window.innerWidth - triggerRect.right))

      // Compute vertical placement: flip up if expanding downward overflows
      const overflowsBottom = triggerRect.top + panelHeight > window.innerHeight - PADDING
      setFlipUp(overflowsBottom || (panelRect ? panelRect.bottom > window.innerHeight - PADDING : false))
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    return () => window.removeEventListener('resize', updatePlacement)
  }, [open, panelWidth])

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    setOpen(true)
  }

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setOpen(false)
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {row({
        open,
        flip,
        toggle: () => {
          if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current)
            leaveTimerRef.current = null
          }
          setOpen((v) => !v)
        },
      })}
      {open && (
        <div
          className={`absolute z-10 ${flipUp ? 'bottom-0' : 'top-0'} ${flip ? 'right-full pr-1.5' : 'left-full pl-1.5'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={panelRef}
            style={{
              width: panelWidth,
              animation: 'smart-menu-in 100ms ease-out forwards',
              '--slide-y': flipUp ? '4px' : '-4px',
            } as React.CSSProperties}
            className="max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
          >
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </div>
  )
}
