import { memo, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'

import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { kindOf, type NoteSort } from '../hooks/useNotesFilter'
import { HIGHLIGHT_COLORS } from './annotation-colors'
import { BookmarkIcon, BulbIcon, CopyIcon, PencilIcon, StyleGlyph, TrashIcon } from './annotation-icons'
import { formatRelativeTime } from './format-relative-time'

function hexOf(a: AnnotationRes): string {
  return HIGHLIGHT_COLORS.find((c) => c.name === a.color)?.hex ?? '#eab308'
}

/** Render the marked text the way it appears in the book: underline / wavy / tinted background */
function highlightDecoration(style: AnnotationStyle, hex: string): CSSProperties {
  if (style === 'highlight') {
    return {
      backgroundColor: `${hex}2e`,
      borderRadius: 2,
      padding: '0 1px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    }
  }
  return {
    textDecoration: 'underline',
    textDecorationColor: hex,
    textDecorationStyle: style === 'squiggly' ? 'wavy' : 'solid',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
  }
}

const actionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'

/** Subtle one-line note total pinned to the top of the notes tab */
function BookOverviewStrip({ total }: { total: number }) {
  const _ = useTranslation()
  return (
    <p className="px-1 text-xs tabular-nums text-[var(--bd-read-sub)]">
      {_('annotation.notesTotal', { n: total })}
    </p>
  )
}

interface NotesPanelProps {
  items: AnnotationRes[]
  total: number
  sort: NoteSort
  locked?: boolean
  onClose?: () => void
  /** Chapter titles in book order, used to sort chapter groups */
  chapterOrder: string[]
  bookId: string
}

export const NotesPanel = memo(function NotesPanel({ items, total, sort, locked, onClose, chapterOrder, bookId }: NotesPanelProps) {
  const _ = useTranslation()
  const { renderer } = useReaderApi()
  const deleteAnnotation = useDeleteAnnotation(bookId)
  const updateAnnotation = useUpdateAnnotation(bookId)
  const addToast = useToastStore((s) => s.addToast)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: AnnotationRes } | null>(null)

  /** Chapter-grouped view, or null when a flat time-sorted list should render */
  const groups = useMemo(() => {
    if (sort !== 'chapter') return null
    const byChapter = new Map<string, AnnotationRes[]>()
    for (const a of items) {
      const key = a.chapter || _('reader.uncategorized')
      if (!byChapter.has(key)) byChapter.set(key, [])
      byChapter.get(key)!.push(a)
    }
    const orderIndex = (name: string) => {
      const i = chapterOrder.indexOf(name)
      return i < 0 ? chapterOrder.length : i
    }
    return Array.from(byChapter.entries())
      .map(([chapter, list]) => ({
        chapter,
        list: list.sort((a, b) => a.cfiRange.localeCompare(b.cfiRange)),
      }))
      .sort((g1, g2) => orderIndex(g1.chapter) - orderIndex(g2.chapter))
  }, [items, sort, chapterOrder, _])

  const flat = useMemo(() => {
    if (sort === 'chapter') return null
    return [...items].sort((a, b) => (sort === 'time-asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
  }, [items, sort])

  useEffect(() => {
    if (!contextMenu) return
    function handle(e: globalThis.MouseEvent) {
      if (!document.getElementById('notes-context-menu')?.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [contextMenu])

  function goTo(item: AnnotationRes) {
    renderer?.display(item.type === 'bookmark' ? item.cfiAnchor || item.cfiRange : item.cfiRange)
    if (!locked) onClose?.()
  }

  function handleContextMenu(e: MouseEvent, item: AnnotationRes) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  async function copyItem(item: AnnotationRes) {
    try {
      await navigator.clipboard.writeText(kindOf(item) === 'idea' ? (item.note ?? '') : item.text)
      addToast(_('reader.copied'), 'success')
    } catch {
      addToast(_('reader.copyFailed'), 'error')
    }
  }

  function renameItem(item: AnnotationRes) {
    const newText = window.prompt('重命名书签', item.text)
    if (newText !== null) {
      updateAnnotation.mutate({ id: item.id, body: { text: newText.trim() || item.text } })
    }
  }

  function deleteItem(item: AnnotationRes) {
    deleteAnnotation.mutate(item.id)
  }

  function renderCard(a: AnnotationRes) {
    const hex = hexOf(a)
    const kind = kindOf(a)
    return (
      <div
        onContextMenu={(e) => handleContextMenu(e, a)}
        className="group rounded-lg border border-stone-200/60 transition-colors hover:bg-stone-500/5 dark:border-stone-800/60"
      >
        <button onClick={() => goTo(a)} className="w-full p-3 text-left">
          {kind === 'bookmark' && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-blue-500">
                <BookmarkIcon />
              </span>
              <p className="line-clamp-2 flex-1 text-sm text-current">{a.text || _('reader.bookmark')}</p>
            </div>
          )}
          {kind === 'idea' && (
            <>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[var(--bd-read-sub)]">
                  <BulbIcon />
                </span>
                <p className="line-clamp-3 flex-1 whitespace-pre-wrap text-sm text-current">{a.note}</p>
              </div>
              {a.text && (
                <div className="ml-7 mt-2 border-l-2 border-stone-300 pl-2 dark:border-stone-600">
                  <p className="line-clamp-2 text-xs text-[var(--bd-read-sub)]">{a.text}</p>
                </div>
              )}
            </>
          )}
          {kind === 'highlight' && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" style={{ color: hex }}>
                <StyleGlyph style={a.style} />
              </span>
              <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-current">
                <span style={highlightDecoration(a.style, hex)}>{a.text}</span>
              </p>
            </div>
          )}
        </button>
        <div className="flex max-h-0 items-center gap-0.5 overflow-hidden px-3 opacity-0 transition-all duration-200 group-hover:max-h-8 group-hover:pb-2 group-hover:opacity-100">
          <span className="text-[11px] text-[var(--bd-read-sub)]">{formatRelativeTime(_, a.createdAt)}</span>
          <div className="flex-1" />
          <button onClick={() => copyItem(a)} title={_('annotation.copy')} className={actionBtn}>
            <CopyIcon />
          </button>
          {a.type === 'bookmark' && (
            <button onClick={() => renameItem(a)} title={_('annotation.rename')} className={actionBtn}>
              <PencilIcon />
            </button>
          )}
          <button onClick={() => deleteItem(a)} title={_('annotation.deleteHighlight')} className={`${actionBtn} text-red-500 hover:bg-red-500/10 hover:text-red-500`}>
            <TrashIcon />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <BookOverviewStrip total={total} />
      {items.length === 0 ? (
        <p className="mt-8 text-center text-xs text-[var(--bd-read-sub)]">{_('reader.noNotes')}</p>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.chapter}>
              <div className="mb-1.5 px-1 text-sm font-semibold text-current">{g.chapter}</div>
              <ul className="space-y-2">
                {g.list.map((a) => (
                  <li key={a.id}>{renderCard(a)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {flat!.map((a) => (
            <li key={a.id}>{renderCard(a)}</li>
          ))}
        </ul>
      )}

      {contextMenu && (
        <div
          id="notes-context-menu"
          className="fixed z-50 min-w-[9rem] rounded-lg border border-stone-200/60 bg-[var(--bd-read-bg)] py-1 shadow-xl dark:border-stone-800/60"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { void copyItem(contextMenu.item); setContextMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
          >
            <span className="text-[var(--bd-read-sub)]"><CopyIcon /></span>
            {_('annotation.copy')}
          </button>
          {contextMenu.item.type === 'bookmark' && (
            <button
              onClick={() => { renameItem(contextMenu.item); setContextMenu(null) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
            >
              <span className="text-[var(--bd-read-sub)]"><PencilIcon /></span>
              {_('annotation.rename')}
            </button>
          )}
          <button
            onClick={() => { deleteItem(contextMenu.item); setContextMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-500/5"
          >
            <TrashIcon />
            {_('reader.delete')}
          </button>
        </div>
      )}
    </div>
  )
})
