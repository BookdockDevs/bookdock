import { useEffect, useRef, useState, type RefObject } from 'react'

import type { AnnotationStyle } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'

import type { ItemKind, NoteSort } from '../hooks/useNotesFilter'
import { COLOR_LABEL_KEYS, HIGHLIGHT_COLORS, HIGHLIGHT_STYLES, STYLE_LABEL_KEYS } from './annotation-colors'
import { StyleGlyph } from './annotation-icons'

const filterPill = 'flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors'
const pillActive = 'border-current bg-current/10 text-current'
const pillIdle = 'border-stone-200/60 text-[var(--bd-read-sub)] hover:bg-stone-500/5 dark:border-stone-800/60'

interface NotesFilterPanelProps {
  open: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  displayTypes: Set<ItemKind>
  onToggleType: (kind: ItemKind) => void
  sort: NoteSort
  onSortChange: (sort: NoteSort) => void
  styleFilter: Set<AnnotationStyle>
  colorFilter: Set<string>
  onToggleStyle: (style: AnnotationStyle) => void
  onToggleColor: (color: string) => void
  onReset: () => void
}

export function NotesFilterPanel({
  open,
  anchorRef,
  onClose,
  displayTypes,
  onToggleType,
  sort,
  onSortChange,
  styleFilter,
  colorFilter,
  onToggleStyle,
  onToggleColor,
  onReset,
}: NotesFilterPanelProps) {
  const _ = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  // fixed-position panel: the sidebar's scroll container would clip an absolute one
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, anchorRef, onClose])

  if (!open || !pos) return null

  return (
    <div
      ref={rootRef}
      className="fixed z-[60] w-64 rounded-xl border border-stone-200/60 bg-[var(--bd-read-bg)] p-3 shadow-xl dark:border-stone-800/60"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="text-xs text-[var(--bd-read-sub)]">{_('annotation.filterType')}</div>
      <div className="mt-1.5 flex gap-1.5">
        {([
          { key: 'highlight', label: _('annotation.drawHighlight') },
          { key: 'idea', label: _('annotation.idea') },
          { key: 'bookmark', label: _('annotation.bookmark') },
        ] as const).map((item) => (
          <button
            key={item.key}
            onClick={() => onToggleType(item.key)}
            className={cn(filterPill, displayTypes.has(item.key) ? pillActive : pillIdle)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-3 text-xs text-[var(--bd-read-sub)]">{_('annotation.filterStyle')}</div>
      <div className="mt-1.5 flex gap-1.5">
        {HIGHLIGHT_STYLES.map((s) => (
          <button
            key={s}
            onClick={() => onToggleStyle(s)}
            title={_(STYLE_LABEL_KEYS[s])}
            className={cn(
              'flex h-9 flex-1 items-center justify-center rounded-lg border transition-colors',
              styleFilter.has(s) ? pillActive : pillIdle,
            )}
          >
            <StyleGlyph style={s} active={styleFilter.has(s)} />
          </button>
        ))}
      </div>
      <div className="mt-3 text-xs text-[var(--bd-read-sub)]">{_('annotation.filterColor')}</div>
      <div className="mt-1.5 flex gap-2">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => onToggleColor(c.name)}
            className={cn(
              'h-5 w-5 rounded-full transition-all',
              colorFilter.has(c.name) ? 'ring-2 ring-current ring-offset-1' : 'hover:scale-110',
            )}
            style={{ backgroundColor: c.hex }}
            title={_(COLOR_LABEL_KEYS[c.name])}
          />
        ))}
      </div>
      <div className="mt-3 text-xs text-[var(--bd-read-sub)]">{_('reader.sort')}</div>
      <div className="mt-1.5 flex gap-1.5">
        {([
          { key: 'chapter', label: _('reader.sortChapter') },
          { key: 'time-desc', label: _('reader.sortTimeDesc') },
          { key: 'time-asc', label: _('reader.sortTimeAsc') },
        ] as const).map((item) => (
          <button
            key={item.key}
            onClick={() => onSortChange(item.key)}
            className={cn(filterPill, sort === item.key ? pillActive : pillIdle)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end border-t border-stone-200/60 pt-2 dark:border-stone-800/60">
        <button
          onClick={onReset}
          className="rounded-lg px-3 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
        >
          {_('annotation.reset')}
        </button>
      </div>
    </div>
  )
}
