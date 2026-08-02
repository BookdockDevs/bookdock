import { useRef, useState } from 'react'

import { computeAtPoint, computeFromAnchor, type SmartPosition } from '@/lib/position'

export function useContextMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function close() { setOpen(false); setPos(null) }
  function openFromEvent(e: React.MouseEvent) { setPos({ x: e.clientX, y: e.clientY }); setOpen(true) }
  function openFromButton() { setPos(null); setOpen(true) }

  function position(menuW: number, menuH: number): SmartPosition | null {
    if (!open) return null
    if (pos) return computeAtPoint(pos, menuW, menuH)
    const btn = btnRef.current
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return computeFromAnchor({ left: r.left, top: r.top, width: r.width, height: r.height }, menuW, menuH)
  }

  return { open, btnRef, menuRef, close, openFromEvent, openFromButton, position }
}
