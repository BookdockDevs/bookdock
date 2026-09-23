import { create } from 'zustand'
import type { NavTab, SelectionInfo } from '../types'

export interface AiPendingQuickCommand {
  id: string
  name: string
  prompt: string
}

export interface SidebarScrollPosition {
  top: number
  currentIndex?: number
}

type SidebarScrollPositions = Record<string, Partial<Record<NavTab, SidebarScrollPosition>>>

const SIDEBAR_SCROLL_STORAGE_KEY = 'bd-reader-sidebar-scroll-v1'

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
        tabs[tab] = {
          top,
          ...(typeof currentIndex === 'number' && Number.isInteger(currentIndex) && currentIndex >= 0 ? { currentIndex } : {}),
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
  setNoteEditorRange: (range: string | null) => void
  setShareTarget: (target: { text: string; chapter: string | null; note?: string; createdAt?: number } | null) => void
  addInvalidReplacementIds: (ids: string[]) => void
  addOrphanedAnnotationKeys: (keys: string[]) => void
  setReplaceTarget: (target: SelectionInfo | null) => void
  resetForBook: (initialSidebarOpen?: boolean, initialNavTab?: NavTab) => void
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
  noteEditorRange: null,
  shareTarget: null,
  invalidReplacementIds: [],
  orphanedAnnotationKeys: [],
  replaceTarget: null,
  setActiveNavTab: (activeNavTab) => set({ activeNavTab }),
  setTocItems: (tocItems, tocBookId: string | null = null) => set({ tocItems, tocBookId }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCurrentChapterHref: (currentChapterHref) => set({ currentChapterHref }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setSidebarScrollPosition: (bookId, tab, position) => set((state) => {
    if (state.sidebarScrollPositions[bookId]?.[tab]?.top === position.top
      && state.sidebarScrollPositions[bookId]?.[tab]?.currentIndex === position.currentIndex) return state
    const sidebarScrollPositions = {
      ...state.sidebarScrollPositions,
      [bookId]: {
        ...state.sidebarScrollPositions[bookId],
        [tab]: position,
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
  setNoteEditorRange: (noteEditorRange) => set({ noteEditorRange }),
  setShareTarget: (shareTarget) => set({ shareTarget }),
  addInvalidReplacementIds: (ids) =>
    set((s) => ({ invalidReplacementIds: Array.from(new Set([...s.invalidReplacementIds, ...ids])) })),
  addOrphanedAnnotationKeys: (keys) =>
    set((s) => ({ orphanedAnnotationKeys: Array.from(new Set([...s.orphanedAnnotationKeys, ...keys])) })),
  setReplaceTarget: (replaceTarget) => set({ replaceTarget }),
  resetForBook: (initialSidebarOpen = false, initialNavTab: NavTab = 'toc') => set({
    activeNavTab: initialNavTab,
    tocItems: [],
    tocBookId: null,
    currentChapter: null,
    currentChapterHref: null,
    currentChapterIndex: null,
    selection: null,
    aiContext: null,
    aiPendingCommand: null,
    sidebarOpen: initialSidebarOpen,
    pendingSearchQuery: null,
    pendingTocHref: null,
    noteEditorRange: null,
    shareTarget: null,
    invalidReplacementIds: [],
    orphanedAnnotationKeys: [],
    replaceTarget: null,
  }),
}))
