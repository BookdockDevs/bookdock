import { create } from 'zustand'
import type { NavTab, SelectionInfo } from '../types'

export interface AiPendingQuickCommand {
  id: string
  name: string
  prompt: string
}

interface ReaderState {
  activeNavTab: NavTab
  tocItems: { label: string; href: string; level?: number }[]
  currentChapter: string | null
  currentChapterIndex: number | null
  selection: SelectionInfo | null
  /** Selection handed off to the AI panel; survives closing the native selection bubble. */
  aiContext: SelectionInfo | null
  /** Quick-command invocation handed off by the selection toolbar; consumed by AiPanel. */
  aiPendingCommand: AiPendingQuickCommand | null
  sidebarOpen: boolean
  /** Set by "search selection" actions; NavigationPanel consumes and clears it */
  pendingSearchQuery: string | null
  /** cfiRange of the idea currently being composed; draws a dashed underline while the editor is open */
  noteEditorRange: string | null
  /** Excerpt being shared as a card image; non-null opens ShareCardDialog. Ephemeral by design — sharing never persists an annotation.
   *  `note`/`createdAt` are set when sharing an idea (想法) instead of a plain excerpt */
  shareTarget: { text: string; chapter: string | null; note?: string; createdAt?: number } | null
  /** Point patches that failed to apply on a loaded section — deduped, so a rule-set reload never re-toasts */
  invalidTransformIds: string[]
  /** Annotation keys (`${cfiRange}|${type}`) whose CFI no longer resolves — orphaned, shown as badges in NotesPanel */
  orphanedAnnotationKeys: string[]
  /** 正文变换 create-from-selection target: opening it collapses the selection
   *  toolbar, so the dialog state must live outside SelectionToolbar (which
   *  unmounts when the selection clears). Rendered by Reader. */
  replaceTarget: SelectionInfo | null
  setActiveNavTab: (tab: NavTab) => void
  setTocItems: (items: { label: string; href: string }[]) => void
  setCurrentChapter: (chapter: string | null) => void
  setCurrentChapterIndex: (index: number | null) => void
  setSelection: (sel: SelectionInfo | null) => void
  setAiContext: (context: SelectionInfo | null) => void
  setAiPendingCommand: (command: AiPendingQuickCommand | null) => void
  setSidebarOpen: (open: boolean) => void
  setPendingSearchQuery: (query: string | null) => void
  setNoteEditorRange: (range: string | null) => void
  setShareTarget: (target: { text: string; chapter: string | null; note?: string; createdAt?: number } | null) => void
  addInvalidTransformIds: (ids: string[]) => void
  addOrphanedAnnotationKeys: (keys: string[]) => void
  setReplaceTarget: (target: SelectionInfo | null) => void
}

export const useReaderState = create<ReaderState>((set) => ({
  activeNavTab: 'toc',
  tocItems: [],
  currentChapter: null,
  currentChapterIndex: null,
  selection: null,
  aiContext: null,
  aiPendingCommand: null,
  sidebarOpen: false,
  pendingSearchQuery: null,
  noteEditorRange: null,
  shareTarget: null,
  invalidTransformIds: [],
  orphanedAnnotationKeys: [],
  replaceTarget: null,
  setActiveNavTab: (activeNavTab) => set({ activeNavTab }),
  setTocItems: (tocItems) => set({ tocItems }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setSelection: (selection) => set({ selection }),
  setAiContext: (aiContext) => set({ aiContext }),
  setAiPendingCommand: (aiPendingCommand) => set({ aiPendingCommand }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPendingSearchQuery: (pendingSearchQuery) => set({ pendingSearchQuery }),
  setNoteEditorRange: (noteEditorRange) => set({ noteEditorRange }),
  setShareTarget: (shareTarget) => set({ shareTarget }),
  addInvalidTransformIds: (ids) =>
    set((s) => ({ invalidTransformIds: Array.from(new Set([...s.invalidTransformIds, ...ids])) })),
  addOrphanedAnnotationKeys: (keys) =>
    set((s) => ({ orphanedAnnotationKeys: Array.from(new Set([...s.orphanedAnnotationKeys, ...keys])) })),
  setReplaceTarget: (replaceTarget) => set({ replaceTarget }),
}))
