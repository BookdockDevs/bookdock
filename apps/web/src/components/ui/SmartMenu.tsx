import { useLayoutEffect, useState, type ReactNode } from 'react'

import { PADDING, type SmartPosition } from '@/lib/position'

interface SmartMenuProps {
  innerRef: React.RefObject<HTMLDivElement | null>
  position: SmartPosition | null
  onClose: () => void
  width?: number
  children: ReactNode
}

export default function SmartMenu({ innerRef, position, onClose, width = 176, children }: SmartMenuProps) {
  // `position` is computed from an estimated height; measure the real menu
  // after render and clamp it into the viewport so the bottom never overflows.
  const [clamped, setClamped] = useState<SmartPosition | null>(null)

  useLayoutEffect(() => {
    setClamped(null)
    if (!position || !innerRef.current) return
    const rect = innerRef.current.getBoundingClientRect()
    const top = Math.max(PADDING, Math.min(position.top, window.innerHeight - rect.height - PADDING))
    const left = Math.max(PADDING, Math.min(position.left, window.innerWidth - rect.width - PADDING))
    if (top !== position.top || left !== position.left) {
      setClamped({ ...position, top, left })
    }
  }, [position, innerRef])

  useLayoutEffect(() => {
    if (!position) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: MouseEvent) => {
      if (innerRef.current && !innerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [position, onClose, innerRef])

  if (!position) return null

  const finalPos = clamped ?? position

  return (
    <div
      ref={innerRef}
      className="fixed z-50 rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95"
      style={{
        left: finalPos.left,
        top: finalPos.top,
        width,
        animation: 'smart-menu-in 120ms ease-out forwards',
        '--slide-y': finalPos.dir === 'down' ? '-4px' : '4px',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
