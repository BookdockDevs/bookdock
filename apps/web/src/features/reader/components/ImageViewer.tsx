import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import { markEscConsumed } from '../lib/esc-consumed'
import { copyImage, downloadImage } from '../lib/image-actions'
import type { ImageMediaInfo } from '../types'

interface ImageViewerProps {
  image: ImageMediaInfo | null
  bookTitle?: string
  onClose: () => void
}

interface Point {
  x: number
  y: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

interface PinchState {
  distance: number
  scale: number
  position: Point
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function clampPosition(p: Point, scale: number): Point {
  if (scale <= 1) return { x: 0, y: 0 }
  const maxDistanceX = Math.max(80, (window.innerWidth * (scale - 0.5)) / 2)
  const maxDistanceY = Math.max(80, (window.innerHeight * (scale - 0.5)) / 2)
  return {
    x: Math.max(-maxDistanceX, Math.min(maxDistanceX, p.x)),
    y: Math.max(-maxDistanceY, Math.min(maxDistanceY, p.y)),
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function zoomedPosition(anchor: Point, fromScale: number, toScale: number, position: Point): Point {
  const ratio = toScale / Math.max(fromScale, MIN_SCALE)
  return {
    x: anchor.x - (anchor.x - position.x) * ratio,
    y: anchor.y - (anchor.y - position.y) * ratio,
  }
}

export function ImageViewer({ image, bookTitle, onClose }: ImageViewerProps) {
  const _ = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const dragRef = useRef<DragState | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 })
  const [busyAction, setBusyAction] = useState<'save' | 'copy' | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const pointerDownPosRef = useRef<Point | null>(null)
  const pointerDownOnBackdropRef = useRef(false)
  const hasDraggedRef = useRef(false)

  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
    setBusyAction(null)
    setJustCopied(false)
    setIsInteracting(false)
    hasDraggedRef.current = false
    pointerDownOnBackdropRef.current = false
    pointerDownPosRef.current = null
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
    if (!image) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        markEscConsumed()
        onClose()
        return
      }

      // Suppress reader page-turn keys while image lightbox is active
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setScale((value) => clampScale(value + SCALE_STEP))
      } else if (event.key === '-') {
        event.preventDefault()
        setScale((value) => {
          const next = clampScale(value - SCALE_STEP)
          if (next <= 1) setPosition({ x: 0, y: 0 })
          return next
        })
      } else if (event.key === '0') {
        event.preventDefault()
        setScale(1)
        setPosition({ x: 0, y: 0 })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [image, onClose])

  if (!image) return null

  const description = image.alt || image.title || _('reader.imageViewerImage')
  const anchorFor = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    }
  }

  const setZoom = (nextValue: number, anchor?: Point) => {
    const next = clampScale(nextValue)
    if (next <= 1) {
      setScale(next)
      setPosition({ x: 0, y: 0 })
      return
    }
    const nextPos = anchor ? zoomedPosition(anchor, scale, next, position) : position
    setPosition(clampPosition(nextPos, next))
    setScale(next)
  }

  const zoomIn = () => setZoom(scale + SCALE_STEP)
  const zoomOut = () => setZoom(scale - SCALE_STEP)
  const resetZoom = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const saveImage = async () => {
    setBusyAction('save')
    try {
      await downloadImage(image, bookTitle)
      notify.success({ key: 'reader.imageViewerSaved' })
    } catch (error) {
      console.warn('[reader] image download failed', error)
      notify.error({ key: 'reader.imageViewerSaveFailed' })
    } finally {
      setBusyAction(null)
    }
  }

  const copyImageToClipboard = async () => {
    setBusyAction('copy')
    try {
      await copyImage(image)
      notify.success({ key: 'reader.imageViewerCopied' })
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 1500)
    } catch (error) {
      console.warn('[reader] image copy failed', error)
      notify.error({ key: 'reader.imageViewerCopyFailed' })
    } finally {
      setBusyAction(null)
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    pointerDownPosRef.current = { x: event.clientX, y: event.clientY }
    pointerDownOnBackdropRef.current = event.target === event.currentTarget
    hasDraggedRef.current = false
    setIsInteracting(true)

    if (pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()]
      const first = points[0]
      const second = points[1]
      if (!first || !second) return
      pinchRef.current = {
        distance: Math.max(1, distance(first, second)),
        scale,
        position,
      }
      dragRef.current = null
      return
    }

    if (scale > 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
      }
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointerDownPosRef.current) {
      const dist = Math.hypot(event.clientX - pointerDownPosRef.current.x, event.clientY - pointerDownPosRef.current.y)
      if (dist > 5) {
        hasDraggedRef.current = true
      }
    }

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const points = [...pointersRef.current.values()]
      const first = points[0]
      const second = points[1]
      if (!first || !second) return
      const currentDistance = Math.max(1, distance(first, second))
      const center = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      }
      const nextScale = clampScale(pinchRef.current.scale * currentDistance / pinchRef.current.distance)
      const anchor = anchorFor(center.x, center.y)
      const nextPosition = nextScale <= 1
        ? { x: 0, y: 0 }
        : clampPosition(zoomedPosition(anchor, pinchRef.current.scale, nextScale, pinchRef.current.position), nextScale)
      event.preventDefault()
      setScale(nextScale)
      setPosition(nextPosition)
      pinchRef.current = {
        distance: currentDistance,
        scale: nextScale,
        position: nextPosition,
      }
      return
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || scale <= 1) return
    event.preventDefault()
    setPosition(clampPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }, scale))
  }

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture may already have been released by the browser.
    }

    // Clean up drag tracking after potential click event finishes
    setTimeout(() => {
      hasDraggedRef.current = false
      pointerDownOnBackdropRef.current = false
      pointerDownPosRef.current = null
    }, 100)

    if (pointersRef.current.size === 1 && scale > 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0] ?? []
      if (pointerId !== undefined && point) {
        dragRef.current = {
          pointerId,
          startX: point.x,
          startY: point.y,
          originX: position.x,
          originY: position.y,
        }
      }
      pinchRef.current = null
      return
    }

    if (pointersRef.current.size === 0) {
      dragRef.current = null
      pinchRef.current = null
      setIsInteracting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] overflow-hidden bg-black/90 backdrop-blur-sm text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label={_('reader.imageViewerTitle')}
      data-testid="image-viewer"
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* Top floating bar with pure icon controls */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-3 sm:p-4 z-20 pointer-events-none">
        <p className="min-w-0 truncate text-xs text-white/70 px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg pointer-events-auto max-w-[40%]" title={description}>
          {description}
        </p>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-stone-900/85 border border-white/10 px-2 py-1 shadow-2xl backdrop-blur-md pointer-events-auto">
          {/* Zoom out */}
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label={_('reader.imageViewerZoomOut')}
            title={_('reader.imageViewerZoomOut')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Scale % (click to reset) */}
          <button
            type="button"
            onClick={resetZoom}
            aria-label={_('reader.imageViewerReset')}
            title={_('reader.imageViewerReset')}
            className="min-w-10 rounded-full px-1.5 py-0.5 text-center text-xs font-mono text-white/90 tabular-nums transition-colors hover:bg-white/15 hover:text-white"
          >
            {Math.round(scale * 100)}%
          </button>

          {/* Zoom in */}
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label={_('reader.imageViewerZoomIn')}
            title={_('reader.imageViewerZoomIn')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <div className="h-3.5 w-px bg-white/20 mx-0.5" />

          {/* Save / Download */}
          <button
            type="button"
            onClick={() => void saveImage()}
            disabled={busyAction !== null}
            aria-label={_('reader.imageViewerSave')}
            title={_('reader.imageViewerSave')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Copy */}
          <button
            type="button"
            onClick={() => void copyImageToClipboard()}
            disabled={busyAction !== null}
            aria-label={_('reader.imageViewerCopy')}
            title={_('reader.imageViewerCopy')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            {justCopied ? (
              <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>

          <div className="h-3.5 w-px bg-white/20 mx-0.5" />

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            aria-label={_('reader.imageViewerClose')}
            title={_('reader.imageViewerClose')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Fullscreen image viewport container */}
      <div
        ref={containerRef}
        className={`absolute inset-0 flex items-center justify-center overflow-hidden touch-none select-none z-10 ${
          isInteracting ? (scale > 1 ? 'cursor-grabbing' : 'cursor-default') : 'cursor-default'
        }`}
        onClick={(event) => {
          if (hasDraggedRef.current) {
            hasDraggedRef.current = false
            return
          }
          if (pointerDownOnBackdropRef.current && event.target === event.currentTarget) {
            onClose()
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={(event) => {
          event.preventDefault()
          const next = scale > 1 ? 1 : 2.5
          setZoom(next, anchorFor(event.clientX, event.clientY))
        }}
        onPointerCancel={onPointerEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onWheel={(event) => {
          event.preventDefault()
          const next = scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP)
          setZoom(next, anchorFor(event.clientX, event.clientY))
        }}
      >
        <img
          src={image.src}
          alt={description}
          title={image.title || undefined}
          draggable={false}
          className={`max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] select-none object-contain shadow-2xl pointer-events-auto ${
            scale > 1 ? (isInteracting ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isInteracting ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>

      {image.alt && image.alt !== description && (
        <p className="absolute inset-x-4 bottom-3 max-h-16 overflow-auto text-center text-xs text-white/60 sm:bottom-4 pointer-events-none z-20">
          {image.alt}
        </p>
      )}
    </div>
  )
}
