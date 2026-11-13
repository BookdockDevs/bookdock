import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import {
  collectClipAncestors,
  isAnchorReachable,
  pointerAnchor,
  resolveMenuAnchor,
  type MenuAnchor,
  type MenuPlacement,
  type MenuSize,
} from '@/lib/menu-anchor'
import type { SmartPosition } from '@/lib/position'

/** Minimal shape of a pointer/touch/context-menu event; avoids React event pooling. */
export interface AnchorPointEvent {
  currentTarget: Element
  clientX: number
  clientY: number
}

export interface AnchorElementOptions {
  placement?: MenuPlacement
  align?: 'start' | 'end'
  gap?: number
}

/**
 * Menu state for one trigger: which element the menu is attached to, and the
 * gesture guards around opening it. Placement is not computed here - SmartMenu
 * derives it from the anchor on every frame, so no coordinate is ever frozen.
 */
export function useMenuAnchor() {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const lastCloseTimeRef = useRef(0)
  // Mirrors `open` so the gesture callbacks stay stable across renders.
  const openRef = useRef(false)
  openRef.current = open

  const close = useCallback(() => {
    lastCloseTimeRef.current = Date.now()
    setOpen(false)
    setAnchor(null)
  }, [])

  /**
   * Synchronous capture, so deferred gestures (long-press timers) keep a valid
   * element and offset after the event object is gone.
   */
  const captureFromEvent = useCallback((event: AnchorPointEvent): MenuAnchor => {
    return pointerAnchor(event.currentTarget, { x: event.clientX, y: event.clientY })
  }, [])

  const openWithAnchor = useCallback((next: MenuAnchor) => {
    setAnchor(next)
    setOpen(true)
  }, [])

  const openFromEvent = useCallback((event: React.MouseEvent) => {
    openWithAnchor(captureFromEvent(event))
  }, [captureFromEvent, openWithAnchor])

  const openAtElement = useCallback((el: Element, options?: AnchorElementOptions) => {
    setAnchor({
      kind: 'element',
      el,
      placement: options?.placement ?? 'side',
      align: options?.align,
      gap: options?.gap,
    })
    setOpen(true)
  }, [])

  const toggleFromButton = useCallback((event?: React.MouseEvent, placement: MenuPlacement = 'side') => {
    // If the menu was just closed by an outside pointerdown in this same click gesture,
    // prevent the subsequent synthetic click event from reopening it.
    if (Date.now() - lastCloseTimeRef.current < 150) return
    if (openRef.current) {
      setAnchor(null)
      setOpen(false)
      return
    }
    const el = event?.currentTarget ?? btnRef.current
    setAnchor(el ? { kind: 'element', el, placement } : null)
    setOpen(true)
  }, [])

  return {
    open,
    anchor,
    menuRef,
    btnRef,
    close,
    captureFromEvent,
    openWithAnchor,
    openFromEvent,
    openAtElement,
    toggleFromButton,
  }
}

/**
 * Keeps a floating menu attached to its anchor for as long as it is open.
 *
 * Reconciliation runs on every animation frame instead of on scroll/resize
 * events because the layout can move without either: filtering a list, a
 * collapsing panel, a transition, an ancestor being scrolled by script. Each
 * frame computes a candidate placement from live geometry and only commits when
 * the *result* changes - gating the computation on "did a rect change" would
 * miss a viewport shrink, where both the anchor and a fixed-width menu keep
 * their rects while the space around them is gone.
 *
 * Size is measured from the menu itself, so `width: 'auto'` and content that
 * grows after opening are placed with their real box rather than an estimate.
 */
export function useReconciledMenuPosition(
  anchor: MenuAnchor | null,
  menuRef: React.RefObject<HTMLElement | null>,
  size: MenuSize,
  onClose: () => void,
): SmartPosition | null {
  // Read through refs: the frame loop must always see the latest values without
  // tearing down and reinstalling itself on every render.
  const anchorRef = useRef(anchor)
  const sizeRef = useRef(size)
  const closeRef = useRef(onClose)
  anchorRef.current = anchor
  sizeRef.current = size
  closeRef.current = onClose

  useLayoutEffect(() => {
    if (!anchor) return

    // Rebuilt per anchor: a node re-parented under a different scroll container
    // must not reuse the previous chain.
    const clips = anchor.el.isConnected ? collectClipAncestors(anchor.el) : []
    let current: SmartPosition | null = null
    let frame = 0
    let stopped = false

    const reconcile = () => {
      const active = anchorRef.current
      if (!active || !active.el.isConnected) return false
      if (!isAnchorReachable(active.el, clips)) return false

      const rect = menuRef.current?.getBoundingClientRect()
      const measured: MenuSize = {
        width: rect && rect.width > 0 ? rect.width : sizeRef.current.width,
        height: rect && rect.height > 0 ? rect.height : sizeRef.current.height,
      }

      const next = resolveMenuAnchor(active, measured)
      if (!next) return false
      const menu = menuRef.current
      const translate = `${next.left}px ${next.top}px`
      const slideY = next.dir === 'down' ? '-4px' : '4px'
      if (
        !current
        || Math.abs(next.left - current.left) > 0.5
        || Math.abs(next.top - current.top) > 0.5
        || next.dir !== current.dir
        || menu?.style.translate !== translate
        || menu?.style.getPropertyValue('--slide-y') !== slideY
      ) {
        current = next
        if (menu) {
          // Keep frame-by-frame movement outside React's render scheduling.
          // Individual translate composes with the existing transform animation.
          menu.style.translate = translate
          menu.style.setProperty('--slide-y', slideY)
        }
      }
      return true
    }

    const tick = () => {
      frame = 0
      if (stopped) return
      if (document.visibilityState !== 'hidden' && !reconcile()) {
        stopped = true
        closeRef.current()
        return
      }
      frame = requestAnimationFrame(tick)
    }

    // One pass before paint so the menu never flashes at a stale spot.
    if (!reconcile()) {
      closeRef.current()
      return
    }
    frame = requestAnimationFrame(tick)

    return () => {
      stopped = true
      if (frame) cancelAnimationFrame(frame)
    }
  }, [anchor, menuRef])

  // Render the first frame immediately so parent layout effects can focus menu
  // items. Subsequent frames write measured placement directly to the DOM.
  const immediate = anchor && anchor.el.isConnected ? resolveMenuAnchor(anchor, size) : null
  return immediate
}
