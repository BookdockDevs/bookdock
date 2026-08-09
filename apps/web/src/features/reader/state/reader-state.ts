import { create } from 'zustand'
import type { NavTab, SelectionInfo } from '../types'

interface ReaderState {
  activeNavTab: NavTab
  tocItems: { label: string; href: string; level?: number }[]
  currentChapter: string | null
  currentChapterIndex: number | null
  selection: SelectionInfo | null
  sidebarOpen: boolean
  /** Set by "search selection" actions; NavigationPanel consumes and clears it */
  pendingSearchQuery: string | null
  /** cfiRange of the idea currently being composed; draws a dashed underline while the editor is open */
  noteEditorRange: string | null
  /** Excerpt being shared as a card image; non-null opens ShareCardDialog. Ephemeral by design — sharing never persists an annotation.
   *  `note`/`createdAt` are set when sharing an idea (想法) instead of a plain excerpt */
  shareTarget: { text: string; chapter: string | null; note?: string; createdAt?: number } | null
  setActiveNavTab: (tab: NavTab) => void
  setTocItems: (items: { label: string; href: string }[]) => void
  setCurrentChapter: (chapter: string | null) => void
  setCurrentChapterIndex: (index: number | null) => void
  setSelection: (sel: SelectionInfo | null) => void
  setSidebarOpen: (open: boolean) => void
  setPendingSearchQuery: (query: string | null) => void
  setNoteEditorRange: (range: string | null) => void
  setShareTarget: (target: { text: string; chapter: string | null; note?: string; createdAt?: number } | null) => void
}

export const useReaderState = create<ReaderState>((set) => ({
  activeNavTab: 'toc',
  tocItems: [],
  currentChapter: null,
  currentChapterIndex: null,
  selection: null,
  sidebarOpen: false,
  pendingSearchQuery: null,
  noteEditorRange: null,
  shareTarget: null,
  setActiveNavTab: (activeNavTab) => set({ activeNavTab }),
  setTocItems: (tocItems) => set({ tocItems }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setSelection: (selection) => set({ selection }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPendingSearchQuery: (pendingSearchQuery) => set({ pendingSearchQuery }),
  setNoteEditorRange: (noteEditorRange) => set({ noteEditorRange }),
  setShareTarget: (shareTarget) => set({ shareTarget }),
}))
