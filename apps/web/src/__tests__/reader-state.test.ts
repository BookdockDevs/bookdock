import { beforeEach, describe, expect, it } from 'vitest'

import { useReaderState } from '../features/reader/state/reader-state'

describe('reader-state resetForBook', () => {
  beforeEach(() => {
    localStorage.clear()
    useReaderState.setState({ sidebarOpen: true, activeNavTab: 'notes', selection: null, sidebarScrollPositions: {} })
  })

  it('collapses the sidebar by default', () => {
    useReaderState.getState().resetForBook()
    expect(useReaderState.getState().sidebarOpen).toBe(false)
    expect(useReaderState.getState().activeNavTab).toBe('toc')
  })

  it('seeds the sidebar open when initialSidebarOpen is true (locked toolbar)', () => {
    useReaderState.getState().resetForBook(true)
    expect(useReaderState.getState().sidebarOpen).toBe(true)
  })

  it('seeds the remembered tab so a locked sidebar reopens where the user left it', () => {
    useReaderState.getState().resetForBook(true, 'notes')
    expect(useReaderState.getState().activeNavTab).toBe('notes')
    expect(useReaderState.getState().sidebarOpen).toBe(true)
  })

  it('falls back to the TOC when no initial tab is given', () => {
    useReaderState.getState().resetForBook(true)
    expect(useReaderState.getState().activeNavTab).toBe('toc')
  })

  it('keeps sidebar positions available when resetting the reader for a book', () => {
    useReaderState.getState().setSidebarScrollPosition('book-1', 'toc', { top: 123, currentIndex: 14 })
    useReaderState.getState().setSidebarScrollPosition('book-1', 'notes', { top: 456 })
    useReaderState.getState().resetForBook()
    expect(useReaderState.getState().sidebarScrollPositions['book-1']).toEqual({
      toc: { top: 123, currentIndex: 14 },
      notes: { top: 456 },
    })
  })

  it('persists sidebar positions for a fresh reader load', () => {
    useReaderState.getState().setSidebarScrollPosition('book-1', 'stats', { top: 789 })
    expect(JSON.parse(localStorage.getItem('bd-reader-sidebar-scroll-v1') ?? '{}')).toEqual({
      'book-1': { stats: { top: 789 } },
    })
  })
})
