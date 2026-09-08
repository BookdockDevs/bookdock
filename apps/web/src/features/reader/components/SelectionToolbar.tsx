import { useEffect, useRef, useState } from 'react'
import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'
import { useReaderState } from '../state/reader-state'
import { useReaderApi } from '../hooks/useReaderApi'
import { useAiQuickCommands, type AiQuickCommand } from '../hooks/useAiQuickCommands'
import { useTtsSession } from '../hooks/useTtsSession'
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
import { AiSparkleIcon, BulbIcon, CopyIcon, ExcerptShareIcon, ReplaceIcon, SearchIcon, StyleGlyph, TrashIcon } from './annotation-icons'

const BAR_WIDTH = 356
const BAR_HEIGHT = 44
const STYLE_WIDTH = 236
const STYLE_HEIGHT = 40
const AI_MENU_WIDTH = 184

const iconBtn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-200 transition-colors hover:bg-white/10 hover:text-white'

interface SelectionToolbarProps {
  bookId: string
  fontStack?: string
  fontCss?: string
}

export function SelectionToolbar({ bookId, fontStack, fontCss }: SelectionToolbarProps) {
  const _ = useTranslation()
  const selection = useReaderState((s) => s.selection)
  const setSelection = useReaderState((s) => s.setSelection)
  const setAiContext = useReaderState((s) => s.setAiContext)
  const setAiPendingCommand = useReaderState((s) => s.setAiPendingCommand)
  const currentChapter = useReaderState((s) => s.currentChapter)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)
  const setNoteEditorRange = useReaderState((s) => s.setNoteEditorRange)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  const setReplaceTarget = useReaderState((s) => s.setReplaceTarget)
  const { renderer } = useReaderApi()
  const { controller: ttsController } = useTtsSession()
  const addToast = useToastStore((s) => s.addToast)
  const create = useCreateAnnotation(bookId)
  const update = useUpdateAnnotation(bookId)
  const del = useDeleteAnnotation(bookId)
  const { data: annotations } = useAnnotations(bookId)
  const { commands: aiCommands } = useAiQuickCommands()

  const [createdLocal, setCreatedLocal] = useState<AnnotationRes | null>(null)
  const [noteEditing, setNoteEditing] = useState(false)
  const [aiMenuAnchor, setAiMenuAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const aiMenuButtonRef = useRef<HTMLButtonElement>(null)
  const aiMenuRef = useRef<HTMLDivElement>(null)
  // A brand-new idea stays local until published — nothing hits the server
  // before the user commits, so cancels leave no placeholder row behind
  const [noteDraft, setNoteDraft] = useState(false)
  const user = useAuthStore((s) => s.user)
  const authorName = getUserDisplayName(user, _('auth.guest'))
  const avatarKey = useAuthStore((s) => s.user?.avatarKey)
  useEffect(() => {
    setCreatedLocal(null)
    setNoteEditing(false)
    setNoteDraft(false)
    setNoteEditorRange(null)
    setAiMenuAnchor(null)
  }, [selection?.cfiRange, setNoteEditorRange])
  useEffect(() => {
    if (!aiMenuAnchor) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || (!aiMenuButtonRef.current?.contains(target) && !aiMenuRef.current?.contains(target))) {
        setAiMenuAnchor(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAiMenuAnchor(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [aiMenuAnchor])

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
        // rawText keeps block-level line breaks; `text` is whitespace-collapsed
        // and would squash the quote into one paragraph on the idea/share cards
        text: (selection.rawText ?? selection.text).slice(0, 800),
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
          text: (selection.rawText ?? selection.text).slice(0, 800),
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
    setPendingSearchQuery(selection.text)
    setActiveNavTab('toc')
    setSidebarOpen(true)
    close()
  }

  function runAiCommand(command: AiQuickCommand) {
    if (!selection) return
    setAiContext({
      ...selection,
      chapterIndex: selection.chapterIndex ?? currentChapterIndex ?? undefined,
      chapterTitle: selection.chapterTitle ?? currentChapter ?? undefined,
    })
    setAiPendingCommand(command)
    renderer?.deselect()
    setSelection(null)
    setNoteEditorRange(null)
    setAiMenuAnchor(null)
    setActiveNavTab('ai')
    setSidebarOpen(true)
  }

  function openAiChat() {
    if (!selection) return
    setAiContext({
      ...selection,
      chapterIndex: selection.chapterIndex ?? currentChapterIndex ?? undefined,
      chapterTitle: selection.chapterTitle ?? currentChapter ?? undefined,
    })
    setAiPendingCommand(null)
    renderer?.deselect()
    setSelection(null)
    setNoteEditorRange(null)
    setAiMenuAnchor(null)
    setActiveNavTab('ai')
    setSidebarOpen(true)
  }

  function toggleAiMenu() {
    if (aiMenuAnchor) {
      setAiMenuAnchor(null)
      return
    }
    const rect = aiMenuButtonRef.current?.getBoundingClientRect()
    if (rect) setAiMenuAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
  }

  function readSelection() {
    if (!selection) return
    void ttsController?.start(selection.cfiRange)
    close()
  }

  // Sharing is ephemeral: the card dialog takes the excerpt text and chapter,
  // no annotation is created for a bare selection
  function shareExcerpt() {
    if (!selection) return
    setShareTarget({
      text: selection.rawText || selection.text,
      chapter: target?.chapter ?? currentChapter ?? null,
    })
    close()
  }

  function shareIdea(entry: IdeaEntry) {
    setShareTarget({
      text: entry.annotation.text,
      chapter: entry.annotation.chapter ?? currentChapter ?? null,
      note: entry.annotation.note ?? undefined,
      createdAt: entry.annotation.createdAt,
    })
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
      authorName,
      authorAvatarKey: avatarKey,
      own: true,
    }))
    return (
      <IdeaOverlay
        entries={entries}
        quoteText={selection.text}
        fontStack={fontStack}
        fontCss={fontCss}
        onCopyQuote={() => void copyQuoteText()}
        onHighlight={() => void highlight()}
        onWriteNote={() => void createNote()}
        onAiChat={openAiChat}
        onShareQuote={shareExcerpt}
        onSearch={searchSelection}
        onCopyNote={(entry) => void copyNote(entry)}
        onShareNote={shareIdea}
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
    { key: 'ai-chat', label: _('reader.aiChatSelection'), icon: <AiSparkleIcon size={18} />, danger: false, onClick: openAiChat },
    { key: 'ai-commands', label: _('reader.aiQuickCommands'), icon: (
      <span className="flex items-center gap-px">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m13 2-8 12h7l-1 8 8-12h-7z" />
        </svg>
        <svg className={`h-2.5 w-2.5 transition-transform ${aiMenuAnchor ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </span>
    ), danger: false, onClick: toggleAiMenu },
    { key: 'tts', label: _('reader.ttsFromSelection'), icon: (
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6 2 29M12 6l9 23M5 20.5h14" />
        <path d="M19 7c5 2.8 7 7 7 11M20 2c7 4 11 9.5 11 16" />
      </svg>
    ), danger: false, onClick: readSelection },
    { key: 'search', label: _('reader.search'), icon: <SearchIcon />, danger: false, onClick: searchSelection },
    { key: 'share', label: _('annotation.shareExcerpt'), icon: <ExcerptShareIcon />, danger: false, onClick: shareExcerpt },
    // Low-frequency text-editing action sits last so the common actions stay put.
    // The replace dialog lives in Reader (via replaceTarget): opening it must
    // collapse this toolbar, but clearing the selection unmounts this
    // component — so only the target is handed off here.
    { key: 'replace', label: _('annotation.replace'), icon: <ReplaceIcon />, danger: false, onClick: () => {
      if (!selection) return
      setReplaceTarget(selection)
      close()
    } },
  ]

  return (
    <>
      {target && (
        <div
          className="fixed z-50 flex h-10 w-max max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            <button key={c.name} onClick={() => restyle({ color: c.name })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110" title={_(COLOR_LABEL_KEYS[c.name])}>
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
        className="fixed z-50 flex h-11 w-max max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto rounded-2xl bg-stone-900/95 px-2 shadow-xl backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ left: bar.left, top: bar.top }}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            ref={a.key === 'ai-commands' ? aiMenuButtonRef : undefined}
            onClick={a.onClick}
            title={a.label}
            aria-haspopup={a.key === 'ai-commands' ? 'menu' : undefined}
            aria-expanded={a.key === 'ai-commands' ? Boolean(aiMenuAnchor) : undefined}
            className={`${iconBtn} ${a.key === 'ai-commands' && aiMenuAnchor ? 'bg-white/15 text-white' : ''} ${a.danger ? 'text-red-400 hover:text-red-300' : ''}`}
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
      {aiMenuAnchor && (
        <div
          ref={aiMenuRef}
          role="menu"
          data-testid="selection-ai-commands"
          aria-label={_('reader.aiQuickCommands')}
          className="fixed z-[51] overflow-y-auto rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1.5 text-[var(--bd-read-text)] shadow-2xl"
          style={{
            left: Math.min(
              Math.max(8, aiMenuAnchor.left - 8),
              Math.max(8, window.innerWidth - AI_MENU_WIDTH - 8),
            ),
            ...(window.innerHeight - aiMenuAnchor.bottom >= 120
              ? { top: aiMenuAnchor.bottom + 6, maxHeight: Math.max(80, window.innerHeight - aiMenuAnchor.bottom - 14) }
              : { bottom: window.innerHeight - aiMenuAnchor.top + 6, maxHeight: Math.max(80, aiMenuAnchor.top - 14) }),
            width: AI_MENU_WIDTH,
          }}
        >
          {aiCommands.length > 0 ? aiCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              role="menuitem"
              onClick={() => runAiCommand(command)}
              className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm transition-colors hover:bg-[var(--bd-read-page-bg)]"
            >
              <span className="min-w-0 flex-1 truncate">{command.name}</span>
            </button>
          )) : <p className="px-3 py-3 text-xs text-[var(--bd-read-sub)]">{_('reader.aiPromptsEmpty')}</p>}
        </div>
      )}
    </>
  )
}
