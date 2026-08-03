import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'

import type { PopupRect } from '../types'
import { BulbIcon, CloseIcon } from './annotation-icons'
import { noteEditorPosition, type NotePlacement } from './note-editor-position'

const VIEWPORT_MARGIN = 12
const SCROLL_SIZE = { width: 560, height: 300 }
const PAGE_SIZE = { width: 400, height: 340 }
const ARROW_SIZE = 14

/** Enter-animation start offset: the bubble slides in from the selection side */
const ANIMATION_OFFSET: Record<NotePlacement, { dx: string; dy: string }> = {
  below: { dx: '0px', dy: '-8px' },
  above: { dx: '0px', dy: '8px' },
  right: { dx: '-8px', dy: '0px' },
  left: { dx: '8px', dy: '0px' },
}

function arrowStyle(placement: NotePlacement, offset: number): CSSProperties {
  const half = ARROW_SIZE / 2
  switch (placement) {
    case 'right':
      return { left: -half, top: offset - half }
    case 'left':
      return { right: -half, top: offset - half }
    case 'below':
      return { top: -half, left: offset - half }
    case 'above':
      return { bottom: -half, left: offset - half }
  }
}

interface NoteEditorPopupProps {
  rect?: PopupRect
  initialNote: string
  saving: boolean
  onSave: (note: string) => void
  onClose: () => void
}

export function NoteEditorPopup({ rect, initialNote, saving, onSave, onClose }: NoteEditorPopupProps) {
  const _ = useTranslation()
  const readingMode = useUiStore((s) => s.readingMode)
  const [draft, setDraft] = useState(initialNote)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  const isPage = readingMode === 'page'
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const base = isPage ? PAGE_SIZE : SCROLL_SIZE
  const size = { width: Math.min(base.width, viewport.width - VIEWPORT_MARGIN * 2), height: base.height }
  const pos = noteEditorPosition(rect, readingMode, size, viewport)
  const arrowOffset = pos.arrowOffset ?? 0
  const showArrow = isPage && pos.arrowOffset !== null
  const anim = ANIMATION_OFFSET[pos.placement]

  function submit() {
    if (!saving && draft.trim()) onSave(draft.trim())
  }

  const textarea = (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
      }}
      placeholder={_('annotation.notePlaceholder')}
      className={`min-h-0 w-full flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none ${
        isPage ? 'placeholder:text-[var(--bd-read-sub)]' : 'text-stone-100 placeholder:text-stone-400'
      }`}
    />
  )

  const publishButton = (
    <button
      onClick={submit}
      disabled={saving || draft.trim() === ''}
      className="rounded-full bg-blue-500 px-5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60"
    >
      {_('annotation.publish')}
    </button>
  )

  return (
    <div
      ref={rootRef}
      className="fixed z-50"
      style={
        {
          left: pos.left,
          top: pos.top,
          width: size.width,
          height: pos.maxHeight ?? size.height,
          animation: 'note-editor-in 140ms ease-out forwards',
          '--note-dx': anim.dx,
          '--note-dy': anim.dy,
        } as CSSProperties
      }
    >
      {showArrow && (
        <span
          className="absolute rotate-45 shadow-2xl"
          style={{
            width: ARROW_SIZE,
            height: ARROW_SIZE,
            backgroundColor: 'var(--bd-read-bg)',
            ...arrowStyle(pos.placement, arrowOffset),
          }}
        />
      )}
      {isPage ? (
        <div
          className="relative flex h-full flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{ backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)' }}
        >
          <div className="relative flex h-11 shrink-0 items-center justify-center border-b border-stone-500/10">
            <span className="text-sm font-medium">{_('annotation.noteTitle')}</span>
            <button
              onClick={onClose}
              title={_('annotation.cancel')}
              className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 gap-2 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-[var(--bd-read-sub)]">
              <BulbIcon />
            </span>
            {textarea}
          </div>
          <div className="flex shrink-0 items-center justify-end px-4 pb-3.5">{publishButton}</div>
        </div>
      ) : (
        <div className="relative flex h-full flex-col rounded-2xl bg-stone-700 shadow-2xl">
          <button
            onClick={onClose}
            title={_('annotation.cancel')}
            className="absolute right-3.5 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-stone-300 transition-colors hover:bg-white/20 hover:text-white"
          >
            <CloseIcon />
          </button>
          <div className="flex min-h-0 flex-1 gap-2.5 px-5 pb-3 pt-4 pr-12">
            <span className="mt-0.5 shrink-0 text-stone-400">
              <BulbIcon />
            </span>
            {textarea}
          </div>
          <div className="flex shrink-0 items-center justify-end px-5 pb-4">{publishButton}</div>
        </div>
      )}
    </div>
  )
}
