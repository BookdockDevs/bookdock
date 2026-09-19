import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { PADDING, type SmartPosition } from '@/lib/position'

interface SmartMenuProps {
  id?: string
  innerRef: React.RefObject<HTMLDivElement | null>
  triggerRef?: React.RefObject<HTMLElement | null>
  position: SmartPosition | null
  onClose: () => void
  width?: number
  variant?: 'default' | 'reader'
  className?: string
  children: ReactNode
}

export default function SmartMenu({
  id,
  innerRef,
  triggerRef,
  position,
  onClose,
  width = 176,
  variant = 'default',
  className = '',
  children,
}: SmartMenuProps) {
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
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null
      if (target && !innerRef.current?.contains(target) && !triggerRef?.current?.contains(target)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    document.addEventListener('content-click', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('content-click', onPointerDown)
    }
  }, [position, onClose, innerRef, triggerRef])

  if (!position) return null

  const finalPos = clamped ?? position

  const themeClass =
    variant === 'reader'
      ? 'border-stone-200/80 bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] dark:border-stone-700/80'
      : 'border-stone-200/80 bg-white/95 text-stone-900 shadow-stone-900/8 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-100'

  // Portaled to body: fixed + z-50 only escapes ancestors that create a
  // stacking context (e.g. the sticky sidebar) when the DOM node is a root child.
  return createPortal(
    <div
      id={id}
      ref={innerRef}
      data-smart-menu="true"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className={`fixed z-50 rounded-xl border p-1 shadow-xl backdrop-blur-md ${themeClass} ${className}`.trim()}
      style={{
        left: finalPos.left,
        top: finalPos.top,
        width,
        animation: 'smart-menu-in 120ms ease-out forwards',
        '--slide-y': finalPos.dir === 'down' ? '-4px' : '4px',
      } as React.CSSProperties}
    >
      {children}
    </div>,
    document.body,
  )
}

export const menuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'

export const menuDangerItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'

export const readerMenuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10'

export const readerMenuDangerItemClass =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10'
