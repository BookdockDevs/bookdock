import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { kindOf, type NoteSort } from '../hooks/useNotesFilter'
import { markEscConsumed } from '../lib/esc-consumed'
import { useReaderState } from '../state/reader-state'
import { HIGHLIGHT_COLORS } from './annotation-colors'
import { BookmarkIcon, BulbIcon, CopyIcon, PencilIcon, ShareIcon, StyleGlyph, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'

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

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Inline card editor replacing the prompt-based rename: auto-growing
 *  textarea, Ctrl+Enter saves, Escape / outside click cancels (mirrors the
 *  selection-toolbar NoteEditorPopup interaction) */
function InlineEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(initial)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        onCancel()
      }
    }
    function onPointerDown(e: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    textareaRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [onCancel])

  function submit() {
    const value = draft.trim()
    if (value) onSave(value)
    else onCancel()
  }

  return (
    <div ref={rootRef} className="p-3" onContextMenu={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          autoGrow(e.target)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)]"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
        >
          {_('annotation.cancel')}
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
        >
          {_('annotation.save')}
        </button>
      </div>
    </div>
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
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  // Annotations whose CFI no longer resolves (P2): badge them and refuse to
  // navigate instead of silently landing nowhere
  const orphanedKeys = useReaderState((s) => s.orphanedAnnotationKeys)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: AnnotationRes } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

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
    function handle(e: Event) {
      if (!document.getElementById('notes-context-menu')?.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    // Clicks inside the foliate iframe never reach document; the renderer
    // relays them as a bubbling `content-click` on the reader container
    document.addEventListener('mousedown', handle)
    document.addEventListener('content-click', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('content-click', handle)
    }
  }, [contextMenu])

  // The click that dismisses the context menu must not also turn a page
  useEffect(() => {
    if (!contextMenu || !renderer) return
    renderer.pushPopupGuard()
    return () => renderer.popPopupGuard()
  }, [contextMenu, renderer])

  function goTo(item: AnnotationRes) {
    if (orphanedKeys.includes(`${item.cfiRange}|${item.type}`)) {
      addToast(_('annotation.orphanedNotice'), 'info')
      return
    }
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

  function saveEdit(item: AnnotationRes, value: string) {
    updateAnnotation.mutate({
      id: item.id,
      body: item.type === 'bookmark' ? { text: value } : { note: value },
    })
    setEditingId(null)
  }

  function deleteItem(item: AnnotationRes) {
    deleteAnnotation.mutate(item.id)
  }

  function shareItem(item: AnnotationRes) {
    setShareTarget({
      text: item.text,
      chapter: item.chapter,
      note: kindOf(item) === 'idea' ? (item.note ?? undefined) : undefined,
      createdAt: item.createdAt,
    })
  }

  function renderCard(a: AnnotationRes) {
    const hex = hexOf(a)
    const kind = kindOf(a)
    const orphaned = orphanedKeys.includes(`${a.cfiRange}|${a.type}`)
    return (
      <div
        onContextMenu={(e) => handleContextMenu(e, a)}
        className={`group relative rounded-lg border border-stone-200/60 transition-colors hover:bg-stone-500/5 dark:border-stone-800/60 ${orphaned ? 'opacity-60' : ''}`}
      >
        {orphaned && (
          <span
            title={_('annotation.orphanedNotice')}
            className="absolute right-2 top-2 z-10 shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-500 dark:border-red-800 dark:text-red-400"
          >
            {_('annotation.orphaned')}
          </span>
        )}
        {editingId === a.id ? (
          <InlineEditor
            initial={a.type === 'bookmark' ? a.text : (a.note ?? '')}
            placeholder={a.type === 'bookmark' ? _('annotation.renamePlaceholder') : _('annotation.notePlaceholder')}
            onSave={(value) => saveEdit(a, value)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <>
            <button onClick={() => goTo(a)} className="w-full p-3 text-left">
              {kind === 'bookmark' && (
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-stone-400 dark:text-stone-500">
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
              <span
                title={formatFullDateTime(_, a.createdAt)}
                className="text-[11px] text-[var(--bd-read-sub)]"
              >
                {formatRelativeTime(_, a.createdAt)}
              </span>
              <div className="flex-1" />
              <button onClick={() => copyItem(a)} title={_('annotation.copy')} className={actionBtn}>
                <CopyIcon />
              </button>
              {a.type !== 'bookmark' && (
                <button onClick={() => shareItem(a)} title={_('annotation.share')} className={actionBtn}>
                  <ShareIcon />
                </button>
              )}
              {a.type === 'bookmark' ? (
                <button onClick={() => setEditingId(a.id)} title={_('annotation.rename')} className={actionBtn}>
                  <PencilIcon />
                </button>
              ) : kind === 'idea' ? (
                <button onClick={() => setEditingId(a.id)} title={_('annotation.editNote')} className={actionBtn}>
                  <PencilIcon />
                </button>
              ) : null}
              <button onClick={() => deleteItem(a)} title={_('annotation.deleteHighlight')} className={`${actionBtn} text-red-500 hover:bg-red-500/10 hover:text-red-500`}>
                <TrashIcon />
              </button>
            </div>
          </>
        )}
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
          className="fixed z-[60] min-w-[9rem] rounded-lg border border-stone-200/60 bg-[var(--bd-read-bg)] py-1 shadow-xl dark:border-stone-800/60"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { void copyItem(contextMenu.item); setContextMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
          >
            <span className="text-[var(--bd-read-sub)] [&>svg]:h-4 [&>svg]:w-4"><CopyIcon /></span>
            {_('annotation.copy')}
          </button>
          {contextMenu.item.type !== 'bookmark' && (
            <button
              onClick={() => { shareItem(contextMenu.item); setContextMenu(null) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-4 [&>svg]:w-4"><ShareIcon /></span>
              {_('annotation.share')}
            </button>
          )}
          {contextMenu.item.type === 'bookmark' && (
            <button
              onClick={() => { setEditingId(contextMenu.item.id); setContextMenu(null) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-4 [&>svg]:w-4"><PencilIcon /></span>
              {_('annotation.rename')}
            </button>
          )}
          {kindOf(contextMenu.item) === 'idea' && (
            <button
              onClick={() => { setEditingId(contextMenu.item.id); setContextMenu(null) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-500/5"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-4 [&>svg]:w-4"><PencilIcon /></span>
              {_('annotation.editNote')}
            </button>
          )}
          <button
            onClick={() => { deleteItem(contextMenu.item); setContextMenu(null) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-500/5"
          >
            <span className="[&>svg]:h-4 [&>svg]:w-4"><TrashIcon /></span>
            {_('reader.delete')}
          </button>
        </div>
      )}
    </div>
  )
})
