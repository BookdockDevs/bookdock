import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui.store'

import type { PopupRect, SelectionGeometry } from '../types'
import { markEscConsumed } from '../lib/esc-consumed'
import { BulbIcon, CloseIcon } from './annotation-icons'
import { noteEditorPosition, type NotePlacement } from './note-editor-position'
import IdeaVisibilityControl from './IdeaVisibilityControl'

const VIEWPORT_MARGIN = 12
const EDITOR_WIDTH = 400

/** Enter-animation start offset: the bubble slides in from the selection side */
const ANIMATION_OFFSET: Record<NotePlacement, { dx: string; dy: string }> = {
  below: { dx: '0px', dy: '-8px' },
  above: { dx: '0px', dy: '8px' },
  right: { dx: '-8px', dy: '0px' },
  left: { dx: '8px', dy: '0px' },
}

interface NoteEditorPopupProps {
  rect?: PopupRect
  geometry?: SelectionGeometry
  initialNote: string
  saving: boolean
  onSave: (note: string) => void
  onClose: () => void
  initialVisibility?: 'private' | 'shared'
  visibilityEligible?: boolean
  sourceReadable?: boolean
  onSaveVisibility?: (note: string, visibility: 'private' | 'shared') => void
}

export function NoteEditorPopup({ rect, geometry, initialNote, saving, onSave, onClose, initialVisibility = 'private', visibilityEligible, sourceReadable = false, onSaveVisibility }: NoteEditorPopupProps) {
  const _ = useTranslation()
  const readingMode = useUiStore((s) => s.readingMode)
  const [draft, setDraft] = useState(initialNote)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [viewport, setViewport] = useState(() => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    bounds: geometry?.bounds,
  }))
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [contentHeight, setContentHeight] = useState(88)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        markEscConsumed()
        onClose()
      }
    }
    function onPointerDown(e: MouseEvent) {
      if (!saving && rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose, saving])

  useEffect(() => {
    const visualViewport = window.visualViewport
    const readingViewport = document.querySelector('[data-reader-viewport]')
    const updateViewport = () => {
      const bounds = readingViewport?.getBoundingClientRect()
      setViewport({
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
        left: visualViewport?.offsetLeft ?? 0,
        top: visualViewport?.offsetTop ?? 0,
        bounds: bounds && bounds.width > 0 ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } : geometry?.bounds,
      })
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    visualViewport?.addEventListener('resize', updateViewport)
    visualViewport?.addEventListener('scroll', updateViewport)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateViewport) : null
    if (readingViewport) observer?.observe(readingViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      visualViewport?.removeEventListener('resize', updateViewport)
      visualViewport?.removeEventListener('scroll', updateViewport)
      observer?.disconnect()
    }
  }, [geometry?.bounds])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const previous = textarea.style.height
    const previousFlex = textarea.style.flex
    textarea.style.flex = 'none'
    textarea.style.height = '0px'
    setContentHeight(Math.max(88, textarea.scrollHeight))
    textarea.style.height = previous
    textarea.style.flex = previousFlex
  }, [draft, viewport.width, viewport.bounds?.width])

  const available = viewport.bounds
  const left = Math.max(viewport.left, available?.left ?? viewport.left)
  const top = Math.max(viewport.top, available?.top ?? viewport.top)
  const right = Math.min(viewport.left + viewport.width, available ? available.left + available.width : viewport.left + viewport.width)
  const bottom = Math.min(viewport.top + viewport.height, available ? available.top + available.height : viewport.top + viewport.height)
  const bounds = { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
  const size = {
    width: Math.max(1, Math.min(EDITOR_WIDTH, bounds.width - VIEWPORT_MARGIN * 2)),
    height: Math.min(380, Math.max(200, contentHeight + 112)),
  }
  const liveGeometry: SelectionGeometry = {
    rects: geometry?.rects ?? (rect ? [rect] : []), bounds,
    backward: geometry?.backward ?? false,
    focusX: geometry?.focusX ?? (rect ? rect.left + rect.width / 2 : left + bounds.width / 2),
  }
  const pos = noteEditorPosition(rect, readingMode, size, viewport, liveGeometry)
  const anim = ANIMATION_OFFSET[pos.placement]

  function submit() {
    if (!saving && draft.trim()) {
      if (onSaveVisibility) onSaveVisibility(draft.trim(), visibility)
      else onSave(draft.trim())
    }
  }

  const textarea = (
    <textarea
      ref={textareaRef}
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
      className="min-h-0 w-full flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none text-[var(--bd-read-text)] placeholder:text-[var(--bd-read-sub)]"
    />
  )

  const hasDraft = draft.trim().length > 0
  const publishButton = (
    <button
      onClick={submit}
      disabled={saving || !hasDraft}
      className={cn(
        'rounded-full px-5 py-1.5 text-sm font-medium transition-all shadow-xs',
        hasDraft && !saving
          ? 'bg-[var(--bd-read-primary)] text-white hover:opacity-90 cursor-pointer active:scale-95'
          : 'bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-500 cursor-not-allowed opacity-60',
      )}
    >
      {_('annotation.publish')}
    </button>
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={_('annotation.noteTitle')}
      className="fixed z-[70]"
      style={
        {
          left: pos.left,
          top: pos.top,
          width: pos.width ?? size.width,
          height: pos.maxHeight ?? size.height,
          animation: 'note-editor-in 140ms ease-out forwards',
          '--note-dx': anim.dx,
          '--note-dy': anim.dy,
        } as CSSProperties
      }
    >
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-xl border border-[var(--bd-read-accent)]/80 shadow-lg"
        style={{ backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)' }}
      >
        <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-[var(--bd-read-accent)]/40 px-4">
          <span className="text-amber-500 dark:text-amber-400"><BulbIcon /></span>
          <span className="text-sm font-medium">{_('annotation.noteTitle')}</span>
          <button
            onClick={onClose}
            disabled={saving}
            title={_('annotation.cancel')}
            className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 px-4 py-3">{textarea}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-3.5">
          {visibilityEligible ? (
            <IdeaVisibilityControl value={visibility} onChange={setVisibility} sourceReadable={sourceReadable} disabled={saving} />
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2.5">
            {publishButton}
          </div>
        </div>
      </div>
    </div>
  )
}
