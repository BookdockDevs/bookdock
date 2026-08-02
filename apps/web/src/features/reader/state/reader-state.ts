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
  setActiveNavTab: (tab: NavTab) => void
  setTocItems: (items: { label: string; href: string }[]) => void
  setCurrentChapter: (chapter: string | null) => void
  setCurrentChapterIndex: (index: number | null) => void
  setSelection: (sel: SelectionInfo | null) => void
  setSidebarOpen: (open: boolean) => void
  setPendingSearchQuery: (query: string | null) => void
}

export const useReaderState = create<ReaderState>((set) => ({
  activeNavTab: 'toc',
  tocItems: [],
  currentChapter: null,
  currentChapterIndex: null,
  selection: null,
  sidebarOpen: false,
  pendingSearchQuery: null,
  setActiveNavTab: (activeNavTab) => set({ activeNavTab }),
  setTocItems: (tocItems) => set({ tocItems }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setSelection: (selection) => set({ selection }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPendingSearchQuery: (pendingSearchQuery) => set({ pendingSearchQuery }),
}))
