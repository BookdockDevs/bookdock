import { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

interface RibbonProps {
  visible: boolean
}

export function Ribbon({ visible }: RibbonProps) {
  const pageWidth = useUiStore((s) => s.pageWidth)
  const horizontalPadding = useUiStore((s) => s.horizontalPadding)
  const readingMode = useUiStore((s) => s.readingMode)
  const ref = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(0)

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    setAreaWidth(parent.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setAreaWidth(parent.clientWidth))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // Mirror the renderer's layout (FoliateReader.updateLayout): the text column is
  // centered in the reading area, so hang the ribbon just inside its right edge
  const base = pageWidth > 0 ? pageWidth : 720
  const inset = readingMode === 'page' ? horizontalPadding * 2 : 0
  const columnWidth = Math.max(320, base - inset)
  const right = Math.max(8, (areaWidth - columnWidth) / 2 + 8)

  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-none absolute top-0 z-30 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ right }}
    >
      <svg
        width="22"
        height="36"
        viewBox="0 0 24 40"
        className="drop-shadow-md"
        style={{ fill: 'var(--bd-read-primary)' }}
      >
        <polygon points="0,0 24,0 24,40 12,32 0,40" />
      </svg>
    </div>
  )
}
