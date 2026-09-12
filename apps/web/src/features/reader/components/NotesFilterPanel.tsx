import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { AnnotationStyle } from '@bookdock/shared'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { markEscConsumed } from '../lib/esc-consumed'

import type { ItemKind, NoteSort } from '../hooks/useNotesFilter'
import { COLOR_LABEL_KEYS, HIGHLIGHT_COLORS, HIGHLIGHT_STYLES, STYLE_LABEL_KEYS } from './annotation-colors'
import { CheckIcon, StyleGlyph } from './annotation-icons'

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
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const [placement, setPlacement] = useState<'right' | 'down'>('right')

  useEffect(() => {
    if (!open) return
    const btn = anchorRef.current
    if (!btn) return

    const rect = btn.getBoundingClientRect()
    const sidebarEl = btn.closest('[data-sidebar-panel]') as HTMLElement | null
    const sidebarRect = sidebarEl ? sidebarEl.getBoundingClientRect() : rect

    const panelWidth = 288
    const margin = 8
    const availableRight = window.innerWidth - sidebarRect.right

    if (availableRight >= panelWidth + margin * 2) {
      // Spacious enough to pop out to the right of the sidebar into the reader area
      setPlacement('right')
      setPos({
        top: Math.max(margin, Math.min(rect.top - 4, window.innerHeight - 380)),
        left: sidebarRect.right + margin,
      })
    } else {
      // Narrow screen fallback: pop below anchor within viewport
      setPlacement('down')
      setPos({
        top: rect.bottom + margin,
        right: Math.max(margin, window.innerWidth - rect.right - 2),
      })
    }

    function handleMouseDown(e: Event) {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        onClose()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('content-click', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('content-click', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, anchorRef, onClose])

  const isChapter = sort === 'chapter' || sort === 'chapter-desc'
  const isChapterDesc = sort === 'chapter-desc'
  const isTime = sort === 'time-desc' || sort === 'time-asc'
  const isTimeAsc = sort === 'time-asc'

  function handleChapterSort() {
    if (isChapter) {
      onSortChange(isChapterDesc ? 'chapter' : 'chapter-desc')
    } else {
      onSortChange('chapter')
    }
  }

  function handleTimeSort() {
    if (isTime) {
      onSortChange(isTimeAsc ? 'time-desc' : 'time-asc')
    } else {
      onSortChange('time-desc')
    }
  }

  const isFiltered = useMemo(
    () => displayTypes.size < 3 || styleFilter.size > 0 || colorFilter.size > 0 || sort !== 'chapter',
    [displayTypes, styleFilter, colorFilter, sort],
  )

  if (!open || !pos) return null

  return (
    <div
      ref={rootRef}
      className={cn(
        'fixed z-[60] w-72 rounded-2xl border p-3.5 space-y-3.5 select-none shadow-2xl animate-modal-panel',
        placement === 'right' ? 'origin-top-left' : 'origin-top-right',
      )}
      style={{
        top: pos.top,
        left: pos.left,
        right: pos.right,
        backgroundColor: 'var(--bd-read-bg)',
        color: 'var(--bd-read-text)',
        borderColor: 'var(--bd-read-accent)',
      }}
    >
      {/* 笔记类型 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--bd-read-sub)] tracking-wide">
          {_('annotation.filterType')}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-500/10 p-1 dark:bg-stone-500/15">
          {([
            { key: 'highlight', label: _('annotation.drawHighlight') },
            { key: 'idea', label: _('annotation.idea') },
            { key: 'bookmark', label: _('annotation.bookmark') },
          ] as const).map((item) => {
            const isActive = displayTypes.has(item.key)
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onToggleType(item.key)}
                className={cn(
                  'flex h-7.5 items-center justify-center rounded-lg text-xs transition-all duration-150 select-none active:scale-[0.98]',
                  isActive
                    ? 'bg-[var(--bd-read-bg)] font-semibold text-[var(--bd-read-text)] shadow-sm border border-black/8 dark:border-white/12'
                    : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] hover:bg-stone-500/5',
                )}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 划线类型 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--bd-read-sub)] tracking-wide">
          {_('annotation.filterStyle')}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-500/10 p-1 dark:bg-stone-500/15">
          {HIGHLIGHT_STYLES.map((s) => {
            const isActive = styleFilter.has(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => onToggleStyle(s)}
                title={_(STYLE_LABEL_KEYS[s])}
                className={cn(
                  'flex h-8 items-center justify-center rounded-lg text-xs transition-all duration-150 select-none active:scale-[0.98]',
                  isActive
                    ? 'bg-[var(--bd-read-bg)] font-semibold text-[var(--bd-read-text)] shadow-sm border border-black/8 dark:border-white/12'
                    : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] hover:bg-stone-500/5',
                )}
              >
                <StyleGlyph style={s} active={isActive} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 划线颜色 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--bd-read-sub)] tracking-wide">
          {_('annotation.filterColor')}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-stone-500/10 p-1.5 px-3 dark:bg-stone-500/15">
          {HIGHLIGHT_COLORS.map((c) => {
            const isSelected = colorFilter.has(c.name)
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onToggleColor(c.name)}
                className={cn(
                  'relative flex h-6.5 w-6.5 items-center justify-center rounded-full transition-all duration-150 select-none',
                  isSelected
                    ? 'scale-110 ring-2 ring-[var(--bd-read-primary)] ring-offset-2 ring-offset-[var(--bd-read-bg)] shadow-xs'
                    : 'hover:scale-105 opacity-80 hover:opacity-100',
                )}
                style={{ backgroundColor: c.hex }}
                title={_(COLOR_LABEL_KEYS[c.name])}
                aria-label={_(COLOR_LABEL_KEYS[c.name])}
                aria-pressed={isSelected}
              >
                {isSelected && (
                  <CheckIcon size={12} strokeWidth={2.6} className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 排序 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--bd-read-sub)] tracking-wide">
          {_('reader.sort')}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-500/10 p-1 dark:bg-stone-500/15">
          <button
            type="button"
            onClick={handleChapterSort}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-all duration-150 select-none active:scale-[0.98]',
              isChapter
                ? 'bg-[var(--bd-read-bg)] font-semibold text-[var(--bd-read-text)] shadow-sm border border-black/8 dark:border-white/12'
                : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] hover:bg-stone-500/5',
            )}
            title={isChapterDesc ? _('reader.sortChapterReverse') : _('reader.sortChapter')}
          >
            <span className="truncate">
              {isChapterDesc ? _('reader.sortChapterReverse') : _('reader.sortChapter')}
            </span>
            <span className={cn('shrink-0 transition-transform duration-200', isChapter && isChapterDesc && 'rotate-180')}>
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={isChapter ? 'text-current' : 'opacity-40'}>
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            onClick={handleTimeSort}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-all duration-150 select-none active:scale-[0.98]',
              isTime
                ? 'bg-[var(--bd-read-bg)] font-semibold text-[var(--bd-read-text)] shadow-sm border border-black/8 dark:border-white/12'
                : 'text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] hover:bg-stone-500/5',
            )}
            title={isTimeAsc ? _('reader.sortTimeAsc') : _('reader.sortTimeDesc')}
          >
            <span className="truncate">
              {isTimeAsc ? _('reader.sortTimeAsc') : _('reader.sortTimeDesc')}
            </span>
            <span className={cn('shrink-0 transition-transform duration-200', isTime && isTimeAsc && 'rotate-180')}>
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={isTime ? 'text-current' : 'opacity-40'}>
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* 底部重置操作栏 */}
      <div className="flex items-center justify-between border-t border-[var(--bd-read-accent)]/50 pt-2.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          {isFiltered && (
            <span className="inline-flex items-center gap-1 font-medium text-[var(--bd-read-primary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--bd-read-primary)]" />
              {_('annotation.filterActive')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={!isFiltered}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
            isFiltered
              ? 'text-[var(--bd-read-primary)] hover:bg-[var(--bd-read-primary)]/10 active:scale-95'
              : 'text-[var(--bd-read-sub)]/35 cursor-not-allowed',
          )}
        >
          {_('annotation.reset')}
        </button>
      </div>
    </div>
  )
}
