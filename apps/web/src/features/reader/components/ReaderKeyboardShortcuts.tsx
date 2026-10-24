import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { apiPut } from '@/api/client'
import { readStoredSettings, writeStoredSettings } from '@/lib/settings-cache'
import { notify } from '@/lib/notifications'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { PENDING_SETTINGS_STORAGE_KEY } from '@/stores/ui.store'
import { cn } from '@/lib/utils'
import {
  READER_SHORTCUT_DEFAULTS,
  normalizeReaderShortcut,
  readReaderShortcuts,
  shortcutConflict,
  shortcutRejection,
  writeReaderShortcuts,
  type ReaderShortcut,
  type ReaderShortcutId,
  type ReaderShortcutMap,
} from '../lib/reader-shortcuts'

interface CommandItem {
  id: ReaderShortcutId
  label: string
}

interface DraftShortcut {
  key: string | null
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

function displayShortcutKey(key: string, command: boolean) {
  if (key === 'ArrowLeft') return '←'
  if (key === 'ArrowRight') return '→'
  if (key === '=' && command) return '+'
  return key.toUpperCase()
}

const commands: CommandItem[] = [
  { id: 'sidebar', label: 'keyboardShortcutSidebar' },
  { id: 'toc', label: 'keyboardShortcutToc' },
  { id: 'notes', label: 'keyboardShortcutNotes' },
  { id: 'search', label: 'keyboardShortcutSearch' },
  { id: 'historyBack', label: 'keyboardShortcutHistoryBack' },
  { id: 'historyForward', label: 'keyboardShortcutHistoryForward' },
  { id: 'chapterStart', label: 'keyboardShortcutChapterStart' },
  { id: 'chapterEnd', label: 'keyboardShortcutChapterEnd' },
  { id: 'tts', label: 'keyboardShortcutTts' },
  { id: 'autoReading', label: 'keyboardShortcutAutoReading' },
  { id: 'fontIncrease', label: 'keyboardShortcutFontIncrease' },
  { id: 'fontDecrease', label: 'keyboardShortcutFontDecrease' },
  { id: 'settings', label: 'keyboardShortcutSettings' },
  { id: 'undo', label: 'keyboardShortcutUndo' },
  { id: 'shortcutsMenu', label: 'keyboardShortcutMenu' },
]

function clearPendingReaderShortcuts(userId: string) {
  try {
    const raw = localStorage.getItem(PENDING_SETTINGS_STORAGE_KEY)
    if (!raw) return
    const pending = JSON.parse(raw) as { userId?: string; payload?: Record<string, unknown> }
    if (pending.userId !== userId || !pending.payload || !('readerShortcuts' in pending.payload)) return
    const payload = { ...pending.payload }
    delete payload.readerShortcuts
    if (Object.keys(payload).length) localStorage.setItem(PENDING_SETTINGS_STORAGE_KEY, JSON.stringify({ userId, payload }))
    else localStorage.removeItem(PENDING_SETTINGS_STORAGE_KEY)
  } catch { /* ignore unavailable storage */ }
}

function isSameShortcut(a: ReaderShortcut | null, b: ReaderShortcut | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.ctrl || a.meta) === Boolean(b.ctrl || b.meta) &&
    a.alt === b.alt &&
    a.shift === b.shift
  )
}

function ShortcutKeyDisplay({ shortcut, unset }: { shortcut: ReaderShortcut | null; unset: string }) {
  if (!shortcut) {
    return <span className="text-xs text-stone-400 dark:text-stone-500">{unset}</span>
  }
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const parts: string[] = []
  if (shortcut.ctrl || shortcut.meta) parts.push(mac ? '⌘' : 'Ctrl')
  if (shortcut.alt) parts.push(mac ? '⌥' : 'Alt')
  if (shortcut.shift) parts.push('Shift')

  parts.push(displayShortcutKey(shortcut.key, shortcut.ctrl || shortcut.meta))

  return (
    <span className="inline-flex items-center gap-1 text-stone-900 dark:text-stone-100">
      {parts.map((p, idx) => (
        <span key={idx} className="inline-flex items-center gap-1">
          {idx > 0 && <span className="text-[10px] text-stone-400 dark:text-stone-500 font-bold">+</span>}
          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-stone-300/90 bg-stone-100 px-1.5 font-mono text-[11px] font-bold text-stone-800 shadow-[0_1px_1px_rgba(0,0,0,0.08)] dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200">
            {p}
          </kbd>
        </span>
      ))}
    </span>
  )
}

function DraftKeyDisplay({
  draft,
  placeholder,
}: {
  draft: DraftShortcut
  placeholder: string
}) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const parts: string[] = []
  if (draft.ctrl || draft.meta) parts.push(mac ? '⌘' : 'Ctrl')
  if (draft.alt) parts.push(mac ? '⌥' : 'Alt')
  if (draft.shift) parts.push('Shift')

  if (draft.key) {
    parts.push(displayShortcutKey(draft.key, draft.ctrl || draft.meta))
  }

  if (parts.length === 0) {
    return <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">{placeholder}</span>
  }

  return (
    <span className="inline-flex items-center gap-1 text-stone-900 dark:text-stone-100">
      {parts.map((p, idx) => (
        <span key={idx} className="inline-flex items-center gap-1">
          {idx > 0 && <span className="text-[10px] text-stone-500 dark:text-stone-400 font-bold">+</span>}
          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-stone-400 bg-stone-200 px-1.5 font-mono text-[11px] font-bold text-stone-900 shadow-xs dark:border-stone-500 dark:bg-stone-700 dark:text-stone-100">
            {p}
          </kbd>
        </span>
      ))}
      {!draft.key && <span className="text-xs font-bold text-stone-500 dark:text-stone-400">…</span>}
    </span>
  )
}

export default function ReaderKeyboardShortcuts({
  onBack,
  onClose,
}: {
  onBack?: () => void
  onClose?: () => void
}) {
  const _ = useTranslation()
  const handleClose = onClose ?? onBack ?? (() => {})
  const handleCloseRef = useRef(handleClose)
  handleCloseRef.current = handleClose
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [map, setMap] = useState<ReaderShortcutMap>(() => readReaderShortcuts(userId))
  const [recording, setRecording] = useState<ReaderShortcutId | null>(null)
  const [draft, setDraft] = useState<DraftShortcut>({ key: null, ctrl: false, alt: false, shift: false, meta: false })
  const [conflict, setConflict] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const syncSequence = useRef(0)
  const syncQueue = useRef(Promise.resolve())

  const update = useCallback((next: ReaderShortcutMap) => {
    setMap(next)
    writeReaderShortcuts(userId, next)
    if (userId) {
      const readerShortcuts = JSON.stringify(next)
      const cached = readStoredSettings(userId)
      if (cached) writeStoredSettings({ ...cached, readerShortcuts }, userId)
      const requestVersion = ++syncSequence.current
      syncQueue.current = syncQueue.current.then(async () => {
        try {
          await apiPut('/settings', { readerShortcuts })
          if (requestVersion === syncSequence.current) clearPendingReaderShortcuts(userId)
        } catch {
          if (requestVersion !== syncSequence.current) return
          try {
            const raw = localStorage.getItem(PENDING_SETTINGS_STORAGE_KEY)
            const prior = raw ? JSON.parse(raw) as { userId?: string; payload?: Record<string, unknown> } : null
            const payload = prior?.userId === userId ? prior.payload ?? {} : {}
            localStorage.setItem(PENDING_SETTINGS_STORAGE_KEY, JSON.stringify({ userId, payload: { ...payload, readerShortcuts } }))
          } catch { /* ignore unavailable storage */ }
          window.dispatchEvent(new Event('bd-settings-pending'))
          notify.warning({ key: 'settings.syncFailed' }, { dedupeKey: 'settings-sync' })
        }
      })
    }
  }, [userId])

  const showConflict = useCallback((id: ReaderShortcutId) => {
    const label = commands.find((item) => item.id === id)?.label
    setConflict(_('reader.keyboardShortcutsConflict', { label: label ? _(`reader.${label}`) : id }))
  }, [_])

  const handleCancelRecording = useCallback(() => {
    setRecording(null)
    setConflict(null)
    setDraft({ key: null, ctrl: false, alt: false, shift: false, meta: false })
  }, [])

  useEffect(() => {
    const close = () => handleCloseRef.current()
    window.addEventListener('bd-reader-shortcuts-close', close)
    return () => window.removeEventListener('bd-reader-shortcuts-close', close)
  }, [])

  const handleSaveDraft = useCallback((targetId?: ReaderShortcutId) => {
    const activeId = targetId ?? recording
    if (!activeId) return

    // If completely cleared, treat as unset
    if (!draft.key && !draft.ctrl && !draft.alt && !draft.shift && !draft.meta) {
      update({ ...map, [activeId]: null })
      handleCancelRecording()
      return
    }

    // Only modifier pressed without a character key
    if (!draft.key) return

    const shortcut: ReaderShortcut = normalizeReaderShortcut({
      key: draft.key,
      ctrl: draft.ctrl,
      alt: draft.alt,
      shift: draft.shift,
      meta: draft.meta,
    })
    const rejected = shortcutRejection(shortcut)
    if (rejected) {
      setConflict(_(rejected))
      return
    }
    const collision = shortcutConflict(map, activeId, shortcut)
    if (collision) {
      showConflict(collision)
      return
    }
    update({ ...map, [activeId]: shortcut })
    handleCancelRecording()
  }, [recording, draft, map, _, update, showConflict, handleCancelRecording])

  useEffect(() => {
    setMap(readReaderShortcuts(userId))
    handleCancelRecording()
  }, [userId, handleCancelRecording])

  useEffect(() => {
    const reload = () => setMap(readReaderShortcuts(userId))
    window.addEventListener('bd-reader-shortcuts-updated', reload)
    window.addEventListener('bd-reader-shortcuts-loaded', reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener('bd-reader-shortcuts-updated', reload)
      window.removeEventListener('bd-reader-shortcuts-loaded', reload)
      window.removeEventListener('storage', reload)
    }
  }, [userId])

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        handleCancelRecording()
        return
      }
      if (event.key === 'Enter') {
        handleSaveDraft()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        setDraft({ key: null, ctrl: false, alt: false, shift: false, meta: false })
        setConflict(null)
        return
      }

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        setDraft((prev) => ({
          ...prev,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        }))
        return
      }

      if (event.key.length === 1 || ['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const key = event.shiftKey && event.code === 'Slash' ? '/' : event.key
        setDraft({
          key,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        })
        setConflict(null)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        setDraft((prev) => {
          if (prev.key) return prev
          return {
            ...prev,
            ctrl: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
            meta: event.metaKey,
          }
        })
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [recording, handleCancelRecording, handleSaveDraft])

  return (
    <Modal
      variant="reader"
      size="default"
      initialFocus="dialog"
      title={_('reader.keyboardShortcuts')}
      panelClassName="bg-[var(--bd-read-bg,var(--bd-read-page-bg,#ffffff))] dark:bg-stone-900"
      onClose={handleClose}
      containerProps={{ 'data-settings-toggle': '', 'data-reader-keyboard-shortcuts': '' }}
      actions={
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          title={_('reader.keyboardShortcutsResetAll')}
          aria-label={_('reader.keyboardShortcutsResetAll')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-[var(--bd-read-page-bg)] hover:text-[var(--bd-read-text)] active:scale-95"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {conflict && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-400"
          >
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{conflict}</span>
            </div>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="rounded p-0.5 opacity-70 hover:opacity-100 hover:bg-red-500/20"
              aria-label={_('library.close')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="divide-y divide-[var(--bd-read-accent)]/10 rounded-xl border border-stone-200/70 bg-stone-500/5 dark:border-stone-800/80 overflow-hidden">
          {commands.map((item) => {
            const current = map[item.id]
            const def = READER_SHORTCUT_DEFAULTS[item.id]
            const isRecording = recording === item.id
            const isDefault = isSameShortcut(current, def)

            return (
              <div
                key={item.id}
                data-testid={`shortcut-row-${item.id}`}
                className={cn(
                  'flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors',
                  isRecording ? 'bg-[var(--bd-read-accent)]/10' : 'hover:bg-stone-500/5',
                )}
              >
                <span className="min-w-0 text-[13px] font-medium text-current truncate">
                  {_(`reader.${item.label}`)}
                </span>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    data-testid={`shortcut-binding-${item.id}`}
                    type="button"
                    onClick={() => {
                      setConflict(null)
                      setRecording(item.id)
                      setDraft({ key: null, ctrl: false, alt: false, shift: false, meta: false })
                    }}
                    className={cn(
                      'inline-flex min-h-[30px] items-center justify-center rounded-lg border px-2.5 py-1 text-xs transition-all active:scale-95',
                      isRecording
                        ? 'border-stone-400 bg-stone-200/80 ring-2 ring-stone-400/40 dark:border-stone-500 dark:bg-stone-800 dark:ring-stone-500/40 shadow-xs'
                        : 'border-stone-300/90 bg-stone-100/60 hover:border-stone-400 hover:bg-stone-200/60 dark:border-stone-700 dark:bg-stone-800/60 dark:hover:border-stone-600 dark:hover:bg-stone-700/60',
                    )}
                  >
                    {isRecording ? (
                      <DraftKeyDisplay
                        draft={draft}
                        placeholder={_('reader.keyboardShortcutsRecord')}
                      />
                    ) : (
                      <ShortcutKeyDisplay shortcut={current} unset={_('reader.keyboardShortcutsUnset')} />
                    )}
                  </button>

                  {isRecording ? (
                    <div className="flex items-center gap-1">
                      <button
                        data-testid={`shortcut-save-${item.id}`}
                        type="button"
                        title={_('library.save')}
                        aria-label={_('library.save')}
                        onClick={() => handleSaveDraft(item.id)}
                        disabled={!draft.key && (draft.ctrl || draft.alt || draft.shift || draft.meta)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>

                      <button
                        data-testid={`shortcut-cancel-${item.id}`}
                        type="button"
                        title={_('reader.keyboardShortcutsCancel')}
                        aria-label={_('reader.keyboardShortcutsCancel')}
                        onClick={handleCancelRecording}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-300 bg-stone-100 text-stone-700 shadow-xs hover:bg-stone-200 hover:text-stone-900 active:scale-95 transition-all dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <button
                        data-testid={`shortcut-clear-${item.id}`}
                        type="button"
                        title={_('reader.keyboardShortcutsClear')}
                        aria-label={_('reader.keyboardShortcutsClear')}
                        onClick={() => {
                          if (current !== null) update({ ...map, [item.id]: null })
                        }}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current',
                          current === null && 'opacity-25 pointer-events-none',
                        )}
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>

                      <button
                        data-testid={`shortcut-default-${item.id}`}
                        type="button"
                        title={_('reader.keyboardShortcutsDefault')}
                        aria-label={_('reader.keyboardShortcutsDefault')}
                        onClick={() => {
                          const shortcut = READER_SHORTCUT_DEFAULTS[item.id]
                          const collision = shortcut && shortcutConflict(map, item.id, shortcut)
                          if (collision) {
                            showConflict(collision)
                            return
                          }
                          update({ ...map, [item.id]: shortcut })
                          setConflict(null)
                        }}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current',
                          isDefault && 'opacity-25 pointer-events-none',
                        )}
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title={_('reader.keyboardShortcutsResetAll')}
          message={_('reader.keyboardShortcutsResetConfirm')}
          confirmLabel={_('reader.keyboardShortcutsResetAll')}
          confirmVariant="primary"
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            update({ ...READER_SHORTCUT_DEFAULTS })
            setConfirmReset(false)
          }}
        />
      )}
    </Modal>
  )
}
