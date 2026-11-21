import { create } from 'zustand'
import type { NavTab, SelectionInfo } from '../types'

export interface AiPendingQuickCommand {
  id: string
  name: string
  prompt: string
  /** Server-side definition reference when the command came from the account's list. */
  promptId?: string
}

export interface SidebarScrollPosition {
  top: number
  currentIndex?: number
  anchorHref?: string
  anchorId?: string
  anchorOffset?: number
  pinnedToBottom?: boolean
  collapsedKeys?: string[]
  /** Page-load token tagging the save. The loader drops it, so a position
   *  restored from a previous load reads as stale: stale positions must not
   *  suppress the TOC locate-on-open. */
  sessionId?: string
}

/** Captures the first visible anchored item in a scroll container and its top offset. */
export function captureScrollAnchor(
  container: HTMLElement | null,
  selector: string,
  datasetKey: string,
  topInset = 0,
): { id: string; offset: number } | null {
  if (!container) return null
  const viewportTop = container.getBoundingClientRect().top
  const threshold = viewportTop + topInset
  const viewportBottom = viewportTop + container.clientHeight
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector))
  let fallback: HTMLElement | undefined
  for (const item of items) {
    const rect = item.getBoundingClientRect()
    if (rect.top >= threshold && rect.top < viewportBottom) {
      const id = item.dataset[datasetKey]
      return id ? { id, offset: rect.top - viewportTop } : null
    }
    if (!fallback && rect.bottom > threshold && rect.top < viewportBottom) {
      fallback = item
    }
  }
  const id = fallback?.dataset[datasetKey]
  return fallback && id ? { id, offset: fallback.getBoundingClientRect().top - viewportTop } : null
}

/** Restores scrollTop and re-anchors to the target element when its layout height changed. */
export function restoreScrollAnchor(
  container: HTMLElement,
  savedTop: number,
  anchorEl: HTMLElement | null | undefined,
  anchorOffset?: number,
): void {
  container.scrollTop = savedTop
  if (anchorEl && anchorOffset !== undefined) {
    container.scrollTop += anchorEl.getBoundingClientRect().top - container.getBoundingClientRect().top - anchorOffset
  }
}

type SidebarScrollPositions = Record<string, Partial<Record<NavTab, SidebarScrollPosition>>>

const SIDEBAR_SCROLL_STORAGE_KEY = 'bd-reader-sidebar-scroll-v1'

/**
 * Unique per page load. Saved scroll positions are tagged with it so readers
 * can tell a same-session remount (restore the exact position, don't yank)
 * from a cross-session reopen (position is stale, locate the current chapter).
 * Never meaningful when persisted: the loader drops it.
 */
export const READER_SESSION_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`

function loadSidebarScrollPositions(): SidebarScrollPositions {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SIDEBAR_SCROLL_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const positions: SidebarScrollPositions = {}
    for (const [bookId, rawTabs] of Object.entries(parsed)) {
      if (!rawTabs || typeof rawTabs !== 'object' || Array.isArray(rawTabs)) continue
      const tabs: Partial<Record<NavTab, SidebarScrollPosition>> = {}
      for (const tab of ['toc', 'notes', 'stats', 'ai'] as NavTab[]) {
        const rawPosition = (rawTabs as Record<string, unknown>)[tab]
        if (!rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) continue
        const top = (rawPosition as Record<string, unknown>).top
        if (typeof top !== 'number' || !Number.isFinite(top) || top < 0) continue
        const currentIndex = (rawPosition as Record<string, unknown>).currentIndex
        const anchorHref = (rawPosition as Record<string, unknown>).anchorHref
        const anchorId = (rawPosition as Record<string, unknown>).anchorId
        const anchorOffset = (rawPosition as Record<string, unknown>).anchorOffset
        const pinnedToBottom = (rawPosition as Record<string, unknown>).pinnedToBottom
        const rawCollapsedKeys = (rawPosition as Record<string, unknown>).collapsedKeys
        const collapsedKeys = Array.isArray(rawCollapsedKeys)
          ? rawCollapsedKeys.filter((k): k is string => typeof k === 'string')
          : undefined
        tabs[tab] = {
          top,
          ...(typeof currentIndex === 'number' && Number.isInteger(currentIndex) && currentIndex >= 0 ? { currentIndex } : {}),
          ...(typeof anchorHref === 'string' && typeof anchorOffset === 'number' && Number.isFinite(anchorOffset)
            ? { anchorHref, anchorOffset } : {}),
          ...(typeof anchorId === 'string' && typeof anchorOffset === 'number' && Number.isFinite(anchorOffset)
            ? { anchorId, anchorOffset } : {}),
          ...(typeof pinnedToBottom === 'boolean' ? { pinnedToBottom } : {}),
          ...(collapsedKeys !== undefined ? { collapsedKeys } : {}),
        }
      }
      if (Object.keys(tabs).length > 0) positions[bookId] = tabs
    }
    return positions
  } catch {
    return {}
  }
}

function persistSidebarScrollPositions(positions: SidebarScrollPositions) {
  try {
    window.localStorage.setItem(SIDEBAR_SCROLL_STORAGE_KEY, JSON.stringify(positions))
  } catch {
    // Ignore storage quota and private-mode errors; the in-memory state remains useful.
  }
}

interface ReaderState {
  activeNavTab: NavTab
  tocItems: { label: string; href: string; level?: number }[]
  tocBookId: string | null
  currentChapter: string | null
  currentChapterHref: string | null
  currentChapterIndex: number | null
  sidebarScrollPositions: SidebarScrollPositions
  selection: SelectionInfo | null
  /** Selection handed off to the AI panel; survives closing the native selection bubble. */
  aiContext: SelectionInfo | null
  /** Quick-command invocation handed off by the selection toolbar; consumed by AiPanel. */
  aiPendingCommand: AiPendingQuickCommand | null
  sidebarOpen: boolean
  /** Set by "search selection" actions; NavigationPanel consumes and clears it */
  pendingSearchQuery: string | null
  /** TOC jump clicked before the renderer mounted; Reader applies it once ready */
  pendingTocHref: string | null
  /** Last TOC target clicked; the directory highlights it before relocation confirms it. */
  pendingNavigationHref: string | null
  /** cfiRange of the idea currently being composed; draws a dashed underline while the editor is open */
  noteEditorRange: string | null
  /** Excerpt being shared as a card image; non-null opens ShareCardDialog. Ephemeral by design — sharing never persists an annotation.
   *  `note`/`createdAt` are set when sharing an idea (想法) instead of a plain excerpt */
  shareTarget: { text: string; chapter: string | null; note?: string; createdAt?: number } | null
  /** Point patches that failed to apply on a loaded section — deduped, so a rule-set reload never re-toasts */
  invalidReplacementIds: string[]
  /** Annotation keys (`${cfiRange}|${type}`) whose CFI no longer resolves — orphaned, shown as badges in NotesPanel */
  orphanedAnnotationKeys: string[]
  /** 文本替换 create-from-selection target: opening it collapses the selection
   *  toolbar, so the dialog state must live outside SelectionToolbar (which
   *  unmounts when the selection clears). Rendered by Reader. */
  replaceTarget: SelectionInfo | null
  translationTarget: SelectionInfo | null
  dictionaryTarget: SelectionInfo | null
  setActiveNavTab: (tab: NavTab) => void
  setTocItems: (items: { label: string; href: string }[], bookId?: string) => void
  setCurrentChapter: (chapter: string | null) => void
  setCurrentChapterHref: (href: string | null) => void
  setCurrentChapterIndex: (index: number | null) => void
  setSidebarScrollPosition: (bookId: string, tab: NavTab, position: SidebarScrollPosition) => void
  setSelection: (sel: SelectionInfo | null) => void
  setAiContext: (context: SelectionInfo | null) => void
  setAiPendingCommand: (command: AiPendingQuickCommand | null) => void
  setSidebarOpen: (open: boolean) => void
  setPendingSearchQuery: (query: string | null) => void
  setPendingTocHref: (href: string | null) => void
  setPendingNavigationHref: (href: string | null) => void
  setNoteEditorRange: (range: string | null) => void
  setShareTarget: (target: { text: string; chapter: string | null; note?: string; createdAt?: number } | null) => void
  addInvalidReplacementIds: (ids: string[]) => void
  addOrphanedAnnotationKeys: (keys: string[]) => void
  setReplaceTarget: (target: SelectionInfo | null) => void
  setTranslationTarget: (target: SelectionInfo | null) => void
  setDictionaryTarget: (target: SelectionInfo | null) => void
  resetForBook: (initialSidebarOpen?: boolean, initialNavTab?: NavTab, bookId?: string) => void
}

export const useReaderState = create<ReaderState>((set) => ({
  activeNavTab: 'toc',
  tocItems: [],
  tocBookId: null,
  currentChapter: null,
  currentChapterHref: null,
  currentChapterIndex: null,
  sidebarScrollPositions: loadSidebarScrollPositions(),
  selection: null,
  aiContext: null,
  aiPendingCommand: null,
  sidebarOpen: false,
  pendingSearchQuery: null,
  pendingTocHref: null,
  pendingNavigationHref: null,
  noteEditorRange: null,
  shareTarget: null,
  invalidReplacementIds: [],
  orphanedAnnotationKeys: [],
  replaceTarget: null,
  translationTarget: null,
  dictionaryTarget: null,
  setActiveNavTab: (activeNavTab) => set({ activeNavTab }),
  setTocItems: (tocItems, tocBookId: string | null = null) => set({ tocItems, tocBookId }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCurrentChapterHref: (currentChapterHref) => set({ currentChapterHref }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setSidebarScrollPosition: (bookId, tab, position) => set((state) => {
    const existing = state.sidebarScrollPositions[bookId]?.[tab]
    const sameCollapsed = existing?.collapsedKeys === position.collapsedKeys
      || (Boolean(existing?.collapsedKeys?.length === position.collapsedKeys?.length)
        && (existing?.collapsedKeys ?? []).every((k, i) => k === position.collapsedKeys?.[i]))
    if (existing?.top === position.top
      && existing?.currentIndex === position.currentIndex
      && existing?.anchorHref === position.anchorHref
      && existing?.anchorId === position.anchorId
      && existing?.anchorOffset === position.anchorOffset
      && existing?.pinnedToBottom === position.pinnedToBottom
      && sameCollapsed
      && existing?.sessionId === READER_SESSION_ID) return state
    const tagged = { ...position, sessionId: READER_SESSION_ID }
    const sidebarScrollPositions = {
      ...state.sidebarScrollPositions,
      [bookId]: {
        ...state.sidebarScrollPositions[bookId],
        [tab]: tagged,
      },
    }
    persistSidebarScrollPositions(sidebarScrollPositions)
    return { sidebarScrollPositions }
  }),
  setSelection: (selection) => set({ selection }),
  setAiContext: (aiContext) => set({ aiContext }),
  setAiPendingCommand: (aiPendingCommand) => set({ aiPendingCommand }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPendingSearchQuery: (pendingSearchQuery) => set({ pendingSearchQuery }),
  setPendingTocHref: (pendingTocHref) => set({ pendingTocHref }),
  setPendingNavigationHref: (pendingNavigationHref) => set({ pendingNavigationHref }),
  setNoteEditorRange: (noteEditorRange) => set({ noteEditorRange }),
  setShareTarget: (shareTarget) => set({ shareTarget }),
  addInvalidReplacementIds: (ids) =>
    set((s) => ({ invalidReplacementIds: Array.from(new Set([...s.invalidReplacementIds, ...ids])) })),
  addOrphanedAnnotationKeys: (keys) =>
    set((s) => ({ orphanedAnnotationKeys: Array.from(new Set([...s.orphanedAnnotationKeys, ...keys])) })),
  setReplaceTarget: (replaceTarget) => set({ replaceTarget }),
  setTranslationTarget: (translationTarget) => set({ translationTarget }),
  setDictionaryTarget: (dictionaryTarget) => set({ dictionaryTarget }),
  resetForBook: (initialSidebarOpen = false, initialNavTab: NavTab = 'toc', bookId?: string) => set((state) => {
    const sameBook = Boolean(bookId && state.tocBookId === bookId)
    return {
      activeNavTab: initialNavTab,
      tocItems: sameBook ? state.tocItems : [],
      tocBookId: sameBook ? state.tocBookId : null,
      currentChapter: sameBook ? state.currentChapter : null,
      currentChapterHref: sameBook ? state.currentChapterHref : null,
      currentChapterIndex: sameBook ? state.currentChapterIndex : null,
      selection: null,
      aiContext: null,
      aiPendingCommand: null,
      sidebarOpen: initialSidebarOpen,
      pendingSearchQuery: null,
      pendingTocHref: null,
      pendingNavigationHref: null,
      noteEditorRange: null,
      shareTarget: null,
      invalidReplacementIds: [],
      orphanedAnnotationKeys: [],
      replaceTarget: null,
      translationTarget: null,
      dictionaryTarget: null,
    }
  }),
}))
