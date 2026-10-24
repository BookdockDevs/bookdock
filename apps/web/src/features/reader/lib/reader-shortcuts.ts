import { hasUndoOpportunity } from '@/lib/undo'

export type ReaderShortcutId = 'sidebar' | 'toc' | 'notes' | 'settings' | 'fontIncrease' | 'fontDecrease' | 'search' | 'historyBack' | 'historyForward' | 'tts' | 'autoReading' | 'chapterStart' | 'chapterEnd' | 'shortcutsMenu' | 'undo'
export interface ReaderShortcut { key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
export type ReaderShortcutMap = Record<ReaderShortcutId, ReaderShortcut | null>

export const READER_SHORTCUT_STORAGE_PREFIX = 'bd-reader-shortcuts:'
export const READER_SHORTCUT_DEFAULTS: ReaderShortcutMap = {
  sidebar: { key: 'p', ctrl: false, alt: false, shift: false, meta: false },
  toc: { key: 't', ctrl: false, alt: false, shift: false, meta: false },
  notes: { key: 'n', ctrl: false, alt: false, shift: false, meta: false },
  settings: { key: 's', ctrl: false, alt: false, shift: false, meta: false },
  fontIncrease: { key: '=', ctrl: true, alt: false, shift: false, meta: false },
  fontDecrease: { key: '-', ctrl: true, alt: false, shift: false, meta: false },
  search: { key: 'f', ctrl: true, alt: false, shift: false, meta: false },
  historyBack: { key: 'ArrowLeft', ctrl: false, alt: true, shift: false, meta: false },
  historyForward: { key: 'ArrowRight', ctrl: false, alt: true, shift: false, meta: false },
  tts: { key: 'r', ctrl: false, alt: false, shift: false, meta: false },
  autoReading: { key: 'a', ctrl: false, alt: false, shift: false, meta: false },
  chapterStart: { key: 'Home', ctrl: false, alt: false, shift: false, meta: false },
  chapterEnd: { key: 'End', ctrl: false, alt: false, shift: false, meta: false },
  shortcutsMenu: { key: '/', ctrl: false, alt: false, shift: true, meta: false },
  undo: { key: 'z', ctrl: true, alt: false, shift: false, meta: false },
}
export function readerShortcutStorageKey(userId: string | null): string {
  return `${READER_SHORTCUT_STORAGE_PREFIX}${userId ?? 'guest'}`
}

export function readReaderShortcuts(userId: string | null): ReaderShortcutMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(readerShortcutStorageKey(userId)) ?? 'null') as Partial<ReaderShortcutMap> | null
    const result = { ...READER_SHORTCUT_DEFAULTS }
    if (!parsed || typeof parsed !== 'object') return result
    for (const id of Object.keys(READER_SHORTCUT_DEFAULTS) as ReaderShortcutId[]) {
      const value = parsed[id]
      if (value === null) result[id] = null
      else if (value && typeof value.key === 'string' && (value.key.length === 1 || ['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(value.key)) &&
        typeof value.ctrl === 'boolean' && typeof value.alt === 'boolean' &&
        typeof value.shift === 'boolean' && typeof value.meta === 'boolean') result[id] = normalizeReaderShortcut(value)
    }
    return result
  } catch {
    return { ...READER_SHORTCUT_DEFAULTS }
  }
}

export function writeReaderShortcuts(userId: string | null, shortcuts: ReaderShortcutMap): void {
  try { localStorage.setItem(readerShortcutStorageKey(userId), JSON.stringify(shortcuts)) } catch { /* private browsing may disable storage */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bd-reader-shortcuts-updated'))
}

export function normalizeReaderShortcut(shortcut: ReaderShortcut): ReaderShortcut {
  if (shortcut.key === '?' && shortcut.shift && !shortcut.ctrl && !shortcut.meta && !shortcut.alt) {
    return { ...shortcut, key: '/' }
  }
  if ((shortcut.ctrl || shortcut.meta) && !shortcut.alt && (shortcut.key === '=' || shortcut.key === '+')) {
    return { ...shortcut, key: '=', shift: false }
  }
  return shortcut
}

export function shortcutMatches(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, shortcut: ReaderShortcut | null): boolean {
  if (!shortcut) return false
  const normalized = normalizeReaderShortcut(shortcut)
  const command = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey
  const shortcutCommand = normalized.meta || normalized.ctrl
  const plusCompatibility = normalized.key === '=' && event.key === '+' && shortcutCommand
  const slashCompatibility = normalized.key === '/' && normalized.shift && event.key === '?'
  return (plusCompatibility || slashCompatibility || event.key.toLowerCase() === normalized.key.toLowerCase())
    && command === shortcutCommand
    && event.altKey === normalized.alt
    && (plusCompatibility || event.shiftKey === normalized.shift)
}

export function shortcutConflict(map: ReaderShortcutMap, id: ReaderShortcutId, shortcut: ReaderShortcut): ReaderShortcutId | null {
  const candidate = normalizeReaderShortcut(shortcut)
  return (Object.keys(map) as ReaderShortcutId[]).find((other) => {
    const existing = map[other] && normalizeReaderShortcut(map[other]!)
    return other !== id && existing !== null && existing !== undefined
      && existing.key.toLowerCase() === candidate.key.toLowerCase()
      && Boolean(existing.ctrl || existing.meta) === Boolean(candidate.ctrl || candidate.meta)
      && existing.alt === candidate.alt && existing.shift === candidate.shift
  }) ?? null
}

export function shortcutRejection(shortcut: ReaderShortcut): string | null {
  const key = shortcut.key.toLowerCase()
  const navigationKey = ['arrowleft', 'arrowright'].includes(key)
  const allowedNavigationBinding = navigationKey && shortcut.alt && !shortcut.ctrl && !shortcut.meta && !shortcut.shift
  if (([' ', 'tab', 'enter', 'escape', 'arrowup', 'arrowdown', 'pageup', 'pagedown'].includes(key) || (navigationKey && !allowedNavigationBinding))) return 'reader.keyboardShortcutsRejectFixed'
  if (['home', 'end'].includes(key) && (shortcut.ctrl || shortcut.meta || shortcut.alt || shortcut.shift)) return 'reader.keyboardShortcutsRejectFixed'
  const modifier = shortcut.ctrl || shortcut.meta
  const browserReserved = /Mac|iPhone|iPad/.test(navigator.platform)
    ? ['q', 'w', 'r', 't', 'l', 'n', 'p', 'o', 's', 'u', 'd', 'h', 'j']
    : ['w', 'r', 't', 'l', 'n', 'p', 'o', 's', 'u', 'd', 'h', 'j']
  if (modifier && browserReserved.includes(key)) return 'reader.keyboardShortcutsRejectReserved'
  return null
}

export function isReaderModalOpen(): boolean {
  return Boolean(document.querySelector('[data-reader-modal], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
}

export function isReaderShortcutModalOpen(): boolean {
  return Boolean(document.querySelector('[data-reader-keyboard-shortcuts]'))
}

export function isReaderContentTarget(target: EventTarget | null, viewport: HTMLElement | null): boolean {
  return target === document.body || target === document.documentElement
    || (target instanceof Node && Boolean(viewport?.contains(target)))
}

export function forwardReaderShortcut(event: KeyboardEvent, host: HTMLElement, shortcuts: ReaderShortcutMap): boolean {
  const target = event.target as HTMLElement | null
  const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  const validEvent = !typing && !event.isComposing && (event as KeyboardEvent & { keyCode?: number }).keyCode !== 229
  const matchesUndo = validEvent && hasUndoOpportunity() && shortcutMatches(event, shortcuts.undo)
  const matchesReaderCommand = validEvent
    && (Object.keys(shortcuts) as ReaderShortcutId[]).filter((id) => id !== 'undo').some((id) => shortcutMatches(event, shortcuts[id]))
  const matches = matchesUndo || matchesReaderCommand
  if (!matches) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  host.dispatchEvent(new KeyboardEvent('keydown', {
    key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey,
        metaKey: event.metaKey, bubbles: true, cancelable: true, isComposing: event.isComposing,
  }))
  return true
}
