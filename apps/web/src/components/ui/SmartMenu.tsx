import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useReconciledMenuPosition } from '@/hooks/useMenuAnchor'
import type { MenuAnchor } from '@/lib/menu-anchor'
import { PADDING } from '@/lib/position'
import { cn } from '@/lib/utils'

export interface SmartMenuSize {
  /** Fixed width in px, or 'auto' to shrink-wrap the widest row between minWidth and maxWidth. */
  width: number | 'auto'
  /** First-frame height estimate; the real box is measured once rendered. */
  height: number
}

interface SmartMenuProps {
  id?: string
  innerRef: React.RefObject<HTMLDivElement | null>
  /**
   * Dismissal exemption only: clicking this element must not close the menu.
   * For a card's context menu that is the "more" button, not the card the menu
   * is anchored to - clicking elsewhere on the card still closes it. Falls back
   * to the anchor element for element-anchored menus that have no button.
   */
  triggerRef?: React.RefObject<HTMLElement | null>
  anchor: MenuAnchor | null
  size: SmartMenuSize
  onClose: () => void
  minWidth?: number
  maxWidth?: number
  variant?: 'default' | 'reader'
  className?: string
  children: ReactNode
}

/**
 * A floating menu attached to an anchor element. Placement is re-derived while
 * the menu is open (see `useReconciledMenuPosition`), so scrolling the page, an
 * inner panel, or shrinking the window keeps the menu on its trigger instead of
 * leaving it frozen at the coordinates it was opened at.
 */
export default function SmartMenu({
  id,
  innerRef,
  triggerRef,
  anchor,
  size,
  onClose,
  minWidth = 160,
  maxWidth = 320,
  variant = 'default',
  className = '',
  children,
}: SmartMenuProps) {
  const autoWidth = size.width === 'auto'
  // Auto-width menus have no known width before they render; maxWidth is the
  // honest upper bound, and the measured box replaces it on the next frame.
  const widthForPlacement = size.width === 'auto' ? Math.min(maxWidth, window.innerWidth - PADDING * 2) : size.width
  const position = useReconciledMenuPosition(anchor, innerRef, { width: widthForPlacement, height: size.height }, onClose)

  useEffect(() => {
    if (!anchor) return
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
      if (!target) return
      const exempt = triggerRef?.current ?? (anchor.kind === 'element' ? anchor.el : null)
      if (!innerRef.current?.contains(target) && !exempt?.contains(target)) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // Both: a touch outside has to dismiss on `pointerdown`, because the
    // browser only synthesises `mousedown` after `touchend` - by then the tap
    // may already have landed on whatever the menu was covering.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('content-click', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('content-click', onPointerDown)
    }
  }, [anchor, onClose, innerRef, triggerRef])

  if (!anchor || !position) return null

  const sizeStyle: React.CSSProperties = autoWidth
    ? {
        minWidth,
        // Never wider than the viewport allows, whatever the caller asks.
        maxWidth: Math.min(maxWidth, window.innerWidth - PADDING * 2),
      }
    : { width: size.width as number }

  const themeClass =
    variant === 'reader'
      ? 'border-stone-200/80 bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] dark:border-stone-700/80'
      : 'border-stone-200/80 bg-white/95 text-stone-900 shadow-stone-900/8 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-100'

  const style = {
    left: 0,
    top: 0,
    translate: `${position.left}px ${position.top}px`,
    ...sizeStyle,
    animation: 'smart-menu-in 120ms ease-out forwards',
    '--slide-y': position.dir === 'down' ? '-4px' : '4px',
  } as React.CSSProperties

  // Portaled to body: fixed + z-50 only escapes ancestors that create a
  // stacking context (e.g. the sticky sidebar) when the DOM node is a root child.
  return createPortal(
    <div
      id={id}
      ref={innerRef}
      data-smart-menu="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className={cn(
        'fixed z-50 rounded-xl border p-1 shadow-xl backdrop-blur-md',
        autoWidth && 'w-max',
        themeClass,
        className,
      )}
      style={style}
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
