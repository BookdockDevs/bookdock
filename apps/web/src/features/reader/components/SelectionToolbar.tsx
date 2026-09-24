import { useEffect, useRef, useState } from 'react'
import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { getUserDisplayName, useAuthStore } from '@/stores/auth.store'
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
import { AiSparkleIcon, BulbIcon, CopyIcon, ExcerptShareIcon, ReplaceIcon, SearchIcon, StyleGlyph, TrashIcon, TtsIcon } from './annotation-icons'

const BAR_WIDTH = 356
const BAR_HEIGHT = 44
const STYLE_WIDTH = 236
const STYLE_HEIGHT = 40
const AI_MENU_WIDTH = 184

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
  const currentChapterHref = useReaderState((s) => s.currentChapterHref)
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)
  const setActiveNavTab = useReaderState((s) => s.setActiveNavTab)
  const setSidebarOpen = useReaderState((s) => s.setSidebarOpen)
  const setPendingSearchQuery = useReaderState((s) => s.setPendingSearchQuery)
  const setNoteEditorRange = useReaderState((s) => s.setNoteEditorRange)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  const setReplaceTarget = useReaderState((s) => s.setReplaceTarget)
  const { renderer } = useReaderApi()
  const { controller: ttsController } = useTtsSession()
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

  const iconBtn = (active?: boolean, danger?: boolean) => cn(
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95',
    danger
      ? 'text-red-500 hover:bg-red-500/10 hover:text-red-600'
      : active
        ? 'bg-stone-500/20 text-[var(--bd-read-text)] font-medium shadow-xs'
        : 'text-[var(--bd-read-text)]/75 hover:bg-stone-500/12 hover:text-[var(--bd-read-text)]',
  )
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
        cfiAnchor: selection.cfiRange,
        type: 'highlight',
        color: last.color,
        style: last.style,
        // rawText keeps block-level line breaks; `text` is whitespace-collapsed
        // and would squash the quote into one paragraph on the idea/share cards
        text: (selection.rawText ?? selection.text).slice(0, 800),
        chapter: currentChapter ?? undefined,
        ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
      })
      // The optimistic cache entry (inserted by the mutation's onMutate) is
      // what renders the highlight, so the native selection can go away
      // immediately instead of waiting for the POST round-trip
      renderer?.deselect()
      const res = await promise
      performance.mark('bd:hl:post-done')
      setCreatedLocal(res.data)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'annotation.saveFailed'))
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
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'annotation.styleUpdateFailed'))
    }
  }

  async function removeAnnotation(id?: string) {
    const annotationId = id ?? target?.id
    if (!annotationId) return
    try {
      await del.mutateAsync(annotationId)
      notify.success({ key: 'annotation.deleted' })
      if (createdLocal?.id === annotationId) setCreatedLocal(null)
      // Deleting one of several ideas at the same range drops back to the
      // overlay's list level; only the last remaining idea closes it
      const remaining = id
        ? (annotations?.data ?? []).filter(
            (a) => a.id !== annotationId && a.type === 'note' && a.cfiRange === selection?.cfiRange,
          )
        : []
      if (remaining.length === 0) close()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'annotation.deleteFailed'))
    }
  }

  function createNote() {
    if (!selection) return
    setNoteDraft(true)
    // Keep the native selection until the editor closes; clearing it here emits
    // selectionchange and unmounts this toolbar before the popup can render.
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
          cfiAnchor: selection.cfiRange,
          type: 'note',
          color: last.color,
          style: last.style,
          text: (selection.rawText ?? selection.text).slice(0, 800),
          chapter: currentChapter ?? undefined,
          ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
          note: note || undefined,
        })
      } else if (target) {
        await update.mutateAsync({ id: target.id, body: { note: note || undefined } })
      }
      close()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'annotation.saveFailed'))
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
      notify.success({ key: 'reader.copied' })
      // Keep the toolbar open only right after creating a highlight (restyle context)
      if (!createdLocal) close()
    } catch {
      notify.error({ key: 'reader.copyFailed' })
    }
  }

  async function copyNote(entry: IdeaEntry) {
    const text = entry.annotation.note
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      notify.success({ key: 'reader.copied' })
    } catch {
      notify.error({ key: 'reader.copyFailed' })
    }
  }

  // Copying inside the idea overlay never dismisses it — the user may copy
  // several fragments from the quote and ideas in one go
  async function copyQuoteText() {
    const text = selection?.rawText || selection?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      notify.success({ key: 'reader.copied' })
    } catch {
      notify.error({ key: 'reader.copyFailed' })
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
      ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
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
      ...(currentChapterHref ? { chapterHref: currentChapterHref } : {}),
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

  const hasStyleBar = Boolean(target)
  const bar = popupPosition(selection.rect, BAR_WIDTH, BAR_HEIGHT, hasStyleBar ? STYLE_HEIGHT + 8 : 0)
  const effectiveBarWidth = Math.min(BAR_WIDTH, Math.max(32, window.innerWidth - 16))
  const effectiveStyleWidth = Math.min(STYLE_WIDTH, Math.max(32, window.innerWidth - 16))
  const styleLeft = Math.min(
    Math.max(8, bar.left + effectiveBarWidth / 2 - effectiveStyleWidth / 2),
    Math.max(8, window.innerWidth - effectiveStyleWidth - 8),
  )
  const styleTop = bar.dir === 'above'
    ? Math.max(8, bar.top - STYLE_HEIGHT - 8)
    : Math.min(window.innerHeight - STYLE_HEIGHT - 8, bar.top + BAR_HEIGHT + 8)

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
    { key: 'ai-chat', label: _('reader.aiChatSelection'), icon: <AiSparkleIcon size={20} />, danger: false, onClick: openAiChat },
    { key: 'ai-commands', label: _('reader.aiQuickCommands'), icon: (
      <span className="flex items-center justify-center gap-0.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m13 2-8 12h7l-1 8 8-12h-7z" />
        </svg>
        <svg className={`h-2 w-2 transition-transform ${aiMenuAnchor ? 'rotate-180' : ''}`} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m2.5 3.5 2.5 2.5 2.5-2.5" />
        </svg>
      </span>
    ), danger: false, onClick: toggleAiMenu },
    { key: 'tts', label: _('reader.ttsFromSelection'), icon: <TtsIcon />, danger: false, onClick: readSelection },
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
          className="fixed z-50 flex h-10 w-max max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto rounded-2xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)]/95 px-2 text-[var(--bd-read-text)] shadow-[0_2px_6px_rgba(0,0,0,0.06),0_6px_16px_-4px_rgba(0,0,0,0.12)] backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ left: styleLeft, top: styleTop }}
        >
          {HIGHLIGHT_STYLES.map((s) => (
            <button
              key={s}
              onClick={() => restyle({ style: s })}
              className={iconBtn(target.style === s)}
              title={_(STYLE_LABEL_KEYS[s])}
            >
              <StyleGlyph
                style={s}
                active={target.style === s}
                color={target.style === s ? highlightHex(target.color) : undefined}
              />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-[var(--bd-read-accent)]/80" />
          {HIGHLIGHT_COLORS.map((c) => {
            const isSelected = target.color === c.name
            const checkmarkStroke = c.name === 'yellow' || c.name === 'green' ? '#1c1917' : '#ffffff'
            return (
              <button
                key={c.name}
                onClick={() => restyle({ color: c.name })}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90',
                  isSelected ? 'scale-105' : 'hover:scale-110',
                )}
                title={_(COLOR_LABEL_KEYS[c.name])}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)] transition-all',
                    isSelected && 'ring-2 ring-stone-400/80 ring-offset-2 ring-offset-[var(--bd-read-bg)] dark:ring-stone-400',
                  )}
                  style={{ backgroundColor: c.hex }}
                >
                  {isSelected && (
                    <svg
                      viewBox="0 0 24 24"
                      width="11"
                      height="11"
                      fill="none"
                      stroke={checkmarkStroke}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m5 13 4 4 10-10" />
                    </svg>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div
        className="fixed z-50 flex h-11 w-max max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto rounded-2xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)]/95 px-2 text-[var(--bd-read-text)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_10px_25px_-5px_rgba(0,0,0,0.18)] backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            className={iconBtn(a.key === 'ai-commands' && Boolean(aiMenuAnchor), a.danger)}
          >
            {a.icon}
          </button>
        ))}
      </div>
      {aiMenuAnchor && (
        <div
          ref={aiMenuRef}
          role="menu"
          data-testid="selection-ai-commands"
          aria-label={_('reader.aiQuickCommands')}
          className="fixed z-[51] overflow-y-auto reader-scrollbar [scrollbar-gutter:stable] rounded-xl border border-[var(--bd-read-accent)]/80 bg-[var(--bd-read-bg)]/95 p-1.5 text-[var(--bd-read-text)] shadow-[0_4px_12px_rgba(0,0,0,0.1),0_12px_28px_-6px_rgba(0,0,0,0.2)] backdrop-blur-md"
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
              className="flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 focus-visible:bg-stone-500/10"
            >
              <span className="min-w-0 flex-1 truncate">{command.name}</span>
            </button>
          )) : (
            <p className="px-3 py-3 text-xs text-[var(--bd-read-sub)]">
              {_('reader.aiPromptsEmpty')}
            </p>
          )}
        </div>
      )}
    </>
  )
}
