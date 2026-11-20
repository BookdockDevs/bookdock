import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { hexToHsv, hsvToHex } from '@/lib/color'
import { isHexColor } from '@/lib/reading-theme'
import { cn } from '@/lib/utils'
import { selectReadingTone, useUiStore } from '@/stores/ui.store'

import ThemeIcon from './ThemeIcon'

export interface ColorPickerPopoverProps {
  value: string
  onChange: (color: string) => void
  anchorRect: DOMRect | null
  onClose: () => void
}

const READING_COLOR_PRESETS = [
  '#FFFFFF', '#F4F4F4', '#F4ECE4', '#DFECE4', '#F7EEDB', '#DDE5E8',
  '#000000', '#111111', '#1C1917', '#1E1E1E', '#1A202C', '#2C2622',
  '#57534E', '#8A7A5F', '#4A7A5F', '#3B82F6', '#F97316', '#E11D48',
]

export default function ColorPickerPopover({ value, onChange, anchorRect, onClose }: ColorPickerPopoverProps) {
  // Portals to body, so it inherits neither the reader surface's colour nor its
  // tone: without both it picked the app's `dark:` styling and body text, which
  // put a dark panel (or light-on-light text) over a light reading theme.
  const readingTone = useUiStore(selectReadingTone)
  const popoverRef = useRef<HTMLDivElement>(null)
  const svBoxRef = useRef<HTMLDivElement>(null)
  const isDraggingSv = useRef(false)

  const [hsv, setHsv] = useState(() => {
    try {
      return isHexColor(value) ? hexToHsv(value) : { h: 35, s: 0.1, v: 0.95 }
    } catch {
      return { h: 35, s: 0.1, v: 0.95 }
    }
  })

  // Synchronize when value changes externally
  useEffect(() => {
    if (isHexColor(value)) {
      try {
        const next = hexToHsv(value)
        setHsv(next)
      } catch {
        // ignore invalid hex
      }
    }
  }, [value])

  // Handle outside click dismissal
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as HTMLElement | null
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [onClose])

  if (!anchorRect) return null

  const popoverWidth = 240
  const popoverHeight = 300
  let left = anchorRect.left
  if (left + popoverWidth > window.innerWidth - 12) {
    left = window.innerWidth - popoverWidth - 12
  }
  if (left < 12) left = 12

  let top = anchorRect.bottom + 6
  if (top + popoverHeight > window.innerHeight - 12) {
    top = Math.max(12, anchorRect.top - popoverHeight - 6)
  }

  const updateSvFromEvent = (clientX: number, clientY: number) => {
    if (!svBoxRef.current) return
    const rect = svBoxRef.current.getBoundingClientRect()
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    setHsv((prev) => {
      const next = { ...prev, s, v }
      onChange(hsvToHex(next.h, next.s, next.v).toUpperCase())
      return next
    })
  }

  const onSvPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingSv.current = true
    updateSvFromEvent(e.clientX, e.clientY)

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDraggingSv.current) return
      updateSvFromEvent(ev.clientX, ev.clientY)
    }

    const onPointerUp = () => {
      isDraggingSv.current = false
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const handleHueSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const h = Number(e.target.value)
    setHsv((prev) => {
      const next = { ...prev, h }
      onChange(hsvToHex(next.h, next.s, next.v).toUpperCase())
      return next
    })
  }

  const handlePresetSelect = (hex: string) => {
    onChange(hex)
    try {
      setHsv(hexToHsv(hex))
    } catch {
      // ignore
    }
  }

  const canEyeDrop = typeof window !== 'undefined' && 'EyeDropper' in window
  const pickWithEyeDropper = async () => {
    try {
      // @ts-expect-error - Chromium web platform feature
      const eyeDropper = new window.EyeDropper()
      const result = await eyeDropper.open()
      if (result?.sRGBHex) {
        const hex = result.sRGBHex.toUpperCase()
        onChange(hex)
        setHsv(hexToHsv(hex))
      }
    } catch {
      // user cancelled
    }
  }

  const pureHueHex = hsvToHex(hsv.h, 1, 1)
  const currentHex = isHexColor(value) ? value.toUpperCase() : hsvToHex(hsv.h, hsv.s, hsv.v).toUpperCase()

  return createPortal(
    <div
      ref={popoverRef}
      data-settings-toggle=""
      data-smart-menu=""
      style={{ top, left, width: popoverWidth }}
      className={cn(
        'fixed z-[85] flex flex-col gap-2.5 rounded-xl border border-stone-200/90 bg-[var(--bd-read-bg,white)] p-2.5 text-[var(--bd-read-text)] shadow-xl ring-1 ring-black/5 select-none animate-in fade-in-0 zoom-in-95 duration-100 dark:border-stone-700/90 dark:bg-stone-900',
        readingTone,
      )}
    >
      {/* 2D Saturation / Value Canvas Area */}
      <div
        ref={svBoxRef}
        onPointerDown={onSvPointerDown}
        style={{
          backgroundColor: pureHueHex,
          backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
        className="relative h-28 w-full cursor-crosshair rounded-lg overflow-hidden border border-black/10 shadow-inner"
      >
        {/* Thumb position indicator */}
        <div
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
          }}
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/30"
        />
      </div>

      {/* Hue Slider */}
      <div className="flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(hsv.h)}
          onChange={handleHueSlider}
          style={{
            background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          }}
          className="h-3 w-full cursor-pointer appearance-none rounded-full shadow-inner outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-md"
        />
      </div>

      {/* Quick Reading Color Presets */}
      <div className="grid grid-cols-6 gap-1.5">
        {READING_COLOR_PRESETS.map((hex) => {
          const isSelected = hex.toUpperCase() === currentHex
          return (
            <button
              key={hex}
              type="button"
              onClick={() => handlePresetSelect(hex)}
              style={{ backgroundColor: hex }}
              title={hex}
              aria-label={hex}
              className={cn(
                'h-5 w-full rounded border border-black/15 shadow-2xs transition-transform active:scale-95',
                isSelected && 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--bd-read-bg,white)] dark:ring-offset-stone-900',
              )}
            />
          )
        })}
      </div>

      {/* Bottom Bar: Preview Swatch + EyeDropper + HEX text */}
      <div className="flex items-center justify-between gap-1.5 pt-0.5 border-t border-stone-200/60 dark:border-stone-800/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            style={{ backgroundColor: currentHex }}
            className="h-5 w-5 shrink-0 rounded border border-black/15 shadow-2xs"
          />
          <span className="font-mono text-xs font-semibold tracking-wide text-current">
            {currentHex}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canEyeDrop && (
            <button
              type="button"
              onClick={pickWithEyeDropper}
              title="屏幕吸管取色"
              aria-label="屏幕吸管取色"
              className="flex h-6 w-6 items-center justify-center rounded text-current/70 hover:bg-stone-500/10 hover:text-current transition-colors"
            >
              <ThemeIcon name="edit" size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-stone-500/15 px-2 py-0.5 text-xs font-medium text-current hover:bg-stone-500/25 transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
