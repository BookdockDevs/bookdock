import { beforeEach, describe, expect, it } from 'vitest'

import { READER_SESSION_ID, useReaderState } from '../features/reader/state/reader-state'

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
      toc: { top: 123, currentIndex: 14, sessionId: expect.any(String) },
      notes: { top: 456, sessionId: expect.any(String) },
    })
  })

  it('persists sidebar positions for a fresh reader load', () => {
    useReaderState.getState().setSidebarScrollPosition('book-1', 'stats', { top: 789 })
    expect(JSON.parse(localStorage.getItem('bd-reader-sidebar-scroll-v1') ?? '{}')).toEqual({
      'book-1': { stats: { top: 789, sessionId: expect.any(String) } },
    })
  })

  it('refreshes a stale session tag even when the saved coordinates are unchanged', () => {
    useReaderState.setState({ sidebarScrollPositions: { 'book-1': { toc: { top: 123, currentIndex: 14 } } } })
    useReaderState.getState().setSidebarScrollPosition('book-1', 'toc', { top: 123, currentIndex: 14 })
    expect(useReaderState.getState().sidebarScrollPositions['book-1'].toc?.sessionId).toBe(READER_SESSION_ID)
  })

  it('preserves TOC items and current chapter when reopening the same book', () => {
    const tocItems = [{ label: '第一章', href: 'ch1.xhtml' }]
    useReaderState.setState({
      tocItems,
      tocBookId: 'book-1',
      currentChapter: '第一章',
      currentChapterHref: 'ch1.xhtml',
      currentChapterIndex: 0,
    })

    useReaderState.getState().resetForBook(true, 'toc', 'book-1')
    expect(useReaderState.getState().tocItems).toEqual(tocItems)
    expect(useReaderState.getState().tocBookId).toBe('book-1')
    expect(useReaderState.getState().currentChapter).toBe('第一章')
    expect(useReaderState.getState().currentChapterHref).toBe('ch1.xhtml')
    expect(useReaderState.getState().currentChapterIndex).toBe(0)

    useReaderState.getState().resetForBook(true, 'toc', 'book-2')
    expect(useReaderState.getState().tocItems).toEqual([])
    expect(useReaderState.getState().tocBookId).toBeNull()
    expect(useReaderState.getState().currentChapter).toBeNull()
    expect(useReaderState.getState().currentChapterHref).toBeNull()
    expect(useReaderState.getState().currentChapterIndex).toBeNull()
  })
})
