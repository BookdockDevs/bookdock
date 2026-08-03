import { useEffect, useState } from 'react'
import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'
import { useReaderState } from '../state/reader-state'
import { useReaderApi } from '../hooks/useReaderApi'
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { IdeaOverlay } from './IdeaOverlay'
import type { IdeaEntry } from './IdeaOverlay'
import { NoteEditorPopup } from './NoteEditorPopup'
import {
  COLOR_LABEL_KEYS,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  STYLE_LABEL_KEYS,
  getLastHighlightStyle,
  getStyleColor,
  highlightHex,
  popupPosition,
  setLastHighlightStyle,
} from './annotation-colors'
import { BulbIcon, CopyIcon, SearchIcon, StyleGlyph, TrashIcon } from './annotation-icons'

const BAR_WIDTH = 176
const BAR_HEIGHT = 44
const STYLE_WIDTH = 236
const STYLE_HEIGHT = 40

const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-full text-stone-200 transition-colors hover:bg-white/10 hover:text-white'

export function SelectionToolbar({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const selection = useReaderState((s) => s.selection)
  const setSelection = useReaderState((s) => s.setSelection)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)
  const setNoteEditorRange = useReaderState((s) => s.setNoteEditorRange)
  const { renderer } = useReaderApi()
  const addToast = useToastStore((s) => s.addToast)
  const create = useCreateAnnotation(bookId)
  const update = useUpdateAnnotation(bookId)
  const del = useDeleteAnnotation(bookId)
  const { data: annotations } = useAnnotations(bookId)

  const [createdLocal, setCreatedLocal] = useState<AnnotationRes | null>(null)
  const [noteEditing, setNoteEditing] = useState(false)
  // A brand-new idea stays local until published — nothing hits the server
  // before the user commits, so cancels leave no placeholder row behind
  const [noteDraft, setNoteDraft] = useState(false)
  const username = useAuthStore((s) => s.user?.username)
  useEffect(() => {
    setCreatedLocal(null)
    setNoteEditing(false)
    setNoteDraft(false)
    setNoteEditorRange(null)
  }, [selection?.cfiRange, setNoteEditorRange])

  if (!selection) return null

  const created = annotations?.data?.find((a) => a.id === createdLocal?.id) ?? createdLocal
  // A range can hold a highlight and an idea at once; the highlight wins when
  // both are clicked — the idea stays reachable from the notes side panel
  const existing = !createdLocal && selection
    ? (annotations?.data?.find((a) => a.cfiRange === selection.cfiRange && a.type === 'highlight')
      ?? annotations?.data?.find((a) => a.cfiRange === selection.cfiRange && a.type === 'note')
      ?? null)
    : null
  const target = created ?? existing

  function close() {
    renderer?.clearSelection()
    setSelection(null)
    setNoteEditorRange(null)
  }

  async function highlight() {
    if (!selection) return
    performance.mark('bd:hl:click')
    const last = getLastHighlightStyle()
    try {
      const promise = create.mutateAsync({
        cfiRange: selection.cfiRange,
        cfiAnchor: selection.anchor,
        type: 'highlight',
        color: last.color,
        style: last.style,
        text: selection.text,
        chapter: currentChapter ?? undefined,
      })
      // The optimistic cache entry (inserted by the mutation's onMutate) is
      // what renders the highlight, so the native selection can go away
      // immediately instead of waiting for the POST round-trip
      renderer?.deselect()
      const res = await promise
      performance.mark('bd:hl:post-done')
      setCreatedLocal(res.data)
    } catch {
      addToast(_('annotation.saveFailed'), 'error')
    }
  }

  async function restyle(patch: { color?: string; style?: AnnotationStyle }) {
    if (!target) return
    const style = patch.style ?? target.style
    // Each style remembers its own color: switching styles restores that style's color
    const color = patch.color ?? (patch.style ? getStyleColor(style) : target.color)
    setLastHighlightStyle(color, style)
    if (createdLocal && created) setCreatedLocal({ ...created, color, style })
    try {
      await update.mutateAsync({ id: target.id, body: patch.color ? patch : { style, color } })
    } catch {
      addToast(_('annotation.saveFailed'), 'error')
    }
  }

  async function removeAnnotation(id?: string) {
    const annotationId = id ?? target?.id
    if (!annotationId) return
    try {
      await del.mutateAsync(annotationId)
      addToast(_('reader.deleted'), 'success')
      if (createdLocal?.id === annotationId) setCreatedLocal(null)
      // Deleting one of several ideas at the same range drops back to the
      // overlay's list level; only the last remaining idea closes it
      const remaining = id
        ? (annotations?.data ?? []).filter(
            (a) => a.id !== annotationId && a.type === 'note' && a.cfiRange === selection?.cfiRange,
          )
        : []
      if (remaining.length === 0) close()
    } catch {
      addToast(_('reader.deleteFailed'), 'error')
    }
  }

  function createNote() {
    if (!selection) return
    setNoteDraft(true)
    renderer?.deselect()
    setNoteEditorRange(selection.cfiRange)
    setNoteEditing(true)
  }

  async function handleSaveNote(note: string) {
    if (!selection) return
    try {
      if (noteDraft) {
        const last = getLastHighlightStyle()
        await create.mutateAsync({
          cfiRange: selection.cfiRange,
          cfiAnchor: selection.anchor,
          type: 'note',
          color: last.color,
          style: last.style,
          text: selection.text,
          chapter: currentChapter ?? undefined,
          note: note || undefined,
        })
      } else if (target) {
        await update.mutateAsync({ id: target.id, body: { note: note || undefined } })
      }
      close()
    } catch {
      addToast(_('annotation.saveFailed'), 'error')
    }
  }

  function handleCloseNoteEditor() {
    setNoteEditing(false)
    setNoteDraft(false)
    // Without close() the stale selection rect would re-open the bubble once
    // noteEditing resets
    close()
  }

  async function copyText() {
    const text = selection?.rawText || selection?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      addToast(_('reader.copied'), 'success')
      // Keep the toolbar open only right after creating a highlight (restyle context)
      if (!createdLocal) close()
    } catch {
      addToast(_('reader.copyFailed'), 'error')
    }
  }

  async function copyNote(entry: IdeaEntry) {
    const text = entry.annotation.note
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      addToast(_('reader.copied'), 'success')
    } catch {
      addToast(_('reader.copyFailed'), 'error')
    }
  }

  // Copying inside the idea overlay never dismisses it — the user may copy
  // several fragments from the quote and ideas in one go
  async function copyQuoteText() {
    const text = selection?.rawText || selection?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      addToast(_('reader.copied'), 'success')
    } catch {
      addToast(_('reader.copyFailed'), 'error')
    }
  }

  function searchSelection() {
    if (!selection?.text) return
    setPendingSearchQuery(selection.text.slice(0, 50))
    setActiveNavTab('toc')
    setSidebarOpen(true)
    close()
  }

  const bar = popupPosition(selection.rect, BAR_WIDTH, BAR_HEIGHT)
  const styleLeft = Math.min(
    Math.max(8, bar.left + BAR_WIDTH / 2 - STYLE_WIDTH / 2),
    Math.max(8, window.innerWidth - STYLE_WIDTH - 8),
  )
  const styleTop = bar.dir === 'above'
    ? Math.max(8, bar.top - STYLE_HEIGHT - 8)
    : bar.top + BAR_HEIGHT + 8

  if (noteEditing) {
    return (
      <NoteEditorPopup
        rect={selection.rect}
        initialNote={noteDraft ? '' : (target?.note ?? '')}
        saving={create.isPending || update.isPending}
        onSave={handleSaveNote}
        onClose={handleCloseNoteEditor}
      />
    )
  }

  // Ideas open the floating overlay (quote card + one entry card per idea,
  // multiple entries are the seam for future circles); selections and
  // highlights get the dark action bubble.
  if (target?.type === 'note') {
    const atRange = annotations?.data?.filter((a) => a.cfiRange === target.cfiRange && a.type === 'note') ?? []
    const entries: IdeaEntry[] = (atRange.length > 0 ? atRange : [target]).map((a) => ({
      annotation: a,
      authorName: username ?? undefined,
      own: true,
    }))
    return (
      <IdeaOverlay
        entries={entries}
        quoteText={selection.text}
        onCopyQuote={() => void copyQuoteText()}
        onHighlight={() => void highlight()}
        onWriteNote={() => void createNote()}
        onSearch={searchSelection}
        onCopyNote={(entry) => void copyNote(entry)}
        onEdit={(entry) => {
          setCreatedLocal(entry.annotation)
          setNoteEditorRange(entry.annotation.cfiRange)
          setNoteEditing(true)
        }}
        onDelete={(entry) => void removeAnnotation(entry.annotation.id)}
        onClose={close}
      />
    )
  }

  // Same bubble for a fresh selection and an existing annotation — once a
  // highlight exists the middle action just flips from 划线 to 删除划线.
  const actions = [
    { key: 'copy', label: _('annotation.copy'), icon: <CopyIcon />, danger: false, onClick: copyText },
    target
      ? { key: 'delete', label: _('annotation.deleteHighlight'), icon: <TrashIcon />, danger: true, onClick: () => removeAnnotation() }
      : { key: 'highlight', label: _('annotation.drawHighlight'), icon: <StyleGlyph style={getLastHighlightStyle().style} />, danger: false, onClick: highlight },
    { key: 'note', label: _('annotation.writeNote'), icon: <BulbIcon />, danger: false, onClick: () => void createNote() },
    { key: 'search', label: _('reader.search'), icon: <SearchIcon />, danger: false, onClick: searchSelection },
  ]

  return (
    <>
      {target && (
        <div
          className="fixed z-50 flex h-10 items-center gap-0.5 rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md"
          style={{ left: styleLeft, top: styleTop }}
        >
          {HIGHLIGHT_STYLES.map((s) => (
            <button
              key={s}
              onClick={() => restyle({ style: s })}
              className={`${iconBtn} ${target.style === s ? 'bg-white/15 text-white' : ''}`}
              title={_(STYLE_LABEL_KEYS[s])}
            >
              <StyleGlyph style={s} color={target.style === s ? highlightHex(target.color) : undefined} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-white/15" />
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.name} onClick={() => restyle({ color: c.name })} className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110" title={_(COLOR_LABEL_KEYS[c.name])}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: c.hex }}>
                {target.color === c.name && (
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#1c1917" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 13 4 4 10-10" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div
        className="fixed z-50 flex h-11 items-center gap-0.5 rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md"
        style={{ left: bar.left, top: bar.top }}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            onClick={a.onClick}
            title={a.label}
            className={`${iconBtn} ${a.danger ? 'text-red-400 hover:text-red-300' : ''}`}
          >
            {a.icon}
          </button>
        ))}
        <span
          className={`absolute h-3 w-3 rotate-45 bg-stone-900/95 ${
            bar.dir === 'above' ? '-bottom-1' : '-top-1'
          }`}
          style={{ left: bar.caretLeft - 6 }}
        />
      </div>
    </>
  )
}
