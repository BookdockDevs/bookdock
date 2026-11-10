import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { markEscConsumed } from '../lib/esc-consumed'
import type { SelectionInfo } from '../types'
import { noteEditorPosition } from './note-editor-position'

interface SelectionUtilityPopupProps {
  title: string
  kind: 'translation' | 'dictionary'
  target: SelectionInfo
  onClose: () => void
  height?: number
  children: ReactNode
}

export default function SelectionUtilityPopup({ title, kind, target, onClose, height = 250, children }: SelectionUtilityPopupProps) {
  const root = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const mode = useUiStore((state) => state.readingMode)
  const user = useAuthStore((state) => state.user)
  const initialUserId = useRef(user?.id ?? null)
  const { renderer } = useReaderApi()
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, bounds: target.geometry?.bounds }))
  useEffect(() => {
    const close = () => closeRef.current()
    const update = () => {
      const visual = window.visualViewport
      const reading = document.querySelector('[data-reader-viewport]')?.getBoundingClientRect()
      const left = Math.max(reading?.left ?? 0, visual?.offsetLeft ?? 0)
      const top = Math.max(reading?.top ?? 0, visual?.offsetTop ?? 0)
      const right = Math.min(reading?.right ?? window.innerWidth, (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth))
      const bottom = Math.min(reading?.bottom ?? window.innerHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight))
      setViewport({ width: window.innerWidth, height: window.innerHeight, bounds: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } })
    }
    const outside = (event: MouseEvent) => {
      const node = event.target as Node | null
      if (root.current?.contains(node)) return
      const element = node instanceof Element ? node : node?.parentElement
      if (element?.closest('[data-reader-translation-popover], [data-reader-dictionary-popover]')) return
      event.preventDefault(); event.stopPropagation(); close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-reader-translation-popover], [data-reader-dictionary-popover]')) return
      markEscConsumed(); event.preventDefault(); event.stopPropagation(); close()
    }
    update()
    window.addEventListener('click', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    const relocated = renderer?.on('relocated', close)
    const selection = renderer?.on('textSelectionStart', close)
    return () => {
      window.removeEventListener('click', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      relocated?.(); selection?.()
    }
  }, [renderer])
  useEffect(() => { if ((user?.id ?? null) !== initialUserId.current) closeRef.current() }, [user])
  const bounds = viewport.bounds ?? { left: 0, top: 0, width: viewport.width, height: viewport.height }
  const size = { width: Math.max(1, Math.min(420, bounds.width - 24)), height: Math.max(1, Math.min(height, bounds.height - 24)) }
  const position = noteEditorPosition(target.rect, mode, size, viewport, { rects: target.geometry?.rects ?? (target.rect ? [target.rect] : []), backward: target.geometry?.backward ?? false, focusX: target.geometry?.focusX ?? target.rect?.left ?? 0, ...target.geometry, bounds })
  return <div ref={root} role="dialog" aria-label={title} data-reader-modal data-reader-translation={kind === 'translation' ? '' : undefined} data-reader-dictionary={kind === 'dictionary' ? '' : undefined} className="fixed z-[70]" style={{ left: position.left, top: position.top, width: position.width ?? size.width, height: position.maxHeight ?? size.height, animation: 'note-editor-in 140ms ease-out forwards', '--note-dx': '0px', '--note-dy': position.placement === 'above' ? '8px' : '-8px' } as CSSProperties}>
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] shadow-lg">{children}</div>
  </div>
}
