import { beforeEach, describe, expect, it } from 'vitest'

import { captureScrollAnchor, READER_SESSION_ID, restoreScrollAnchor, useReaderState } from '../features/reader/state/reader-state'

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

  it('seeds the sidebar open when initialSidebarOpen is true (pinned or floating)', () => {
    useReaderState.getState().resetForBook(true)
    expect(useReaderState.getState().sidebarOpen).toBe(true)
  })

  it('seeds the remembered tab so the sidebar reopens where the user left it', () => {
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

  it('preserves empty collapsedKeys [] (all expanded) when persisted to and reloaded from localStorage', () => {
    useReaderState.getState().setSidebarScrollPosition('book-1', 'toc', { top: 0, collapsedKeys: [] })
    const stored = JSON.parse(localStorage.getItem('bd-reader-sidebar-scroll-v1') ?? '{}')
    expect(stored['book-1']?.toc?.collapsedKeys).toEqual([])
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

  it('captures and restores scroll anchors across layout height changes', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true })
    container.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 0, right: 200, width: 200, height: 200, x: 0, y: 100, toJSON: () => ({}) })

    const itemA = document.createElement('div')
    itemA.dataset.noteId = 'note-a'
    itemA.getBoundingClientRect = () => ({ top: 60, bottom: 130, left: 0, right: 200, width: 200, height: 70, x: 0, y: 60, toJSON: () => ({}) })

    const itemB = document.createElement('div')
    itemB.dataset.noteId = 'note-b'
    itemB.getBoundingClientRect = () => ({ top: 140, bottom: 210, left: 0, right: 200, width: 200, height: 70, x: 0, y: 140, toJSON: () => ({}) })

    container.append(itemA, itemB)

    const anchor = captureScrollAnchor(container, '[data-note-id]', 'noteId', 0)
    expect(anchor).toEqual({ id: 'note-b', offset: 40 })

    // Simulate narrower/wider layout shifting itemB down by 25px after setting savedTop
    itemB.getBoundingClientRect = () => ({ top: 165, bottom: 255, left: 0, right: 200, width: 200, height: 90, x: 0, y: 165, toJSON: () => ({}) })
    restoreScrollAnchor(container, 120, itemB, anchor?.offset)
    expect(container.scrollTop).toBe(145)
  })

  it('persists anchorId and pinnedToBottom for notes and ai scroll positions', () => {
    useReaderState.getState().setSidebarScrollPosition('book-1', 'notes', {
      top: 120,
      anchorId: 'note-2',
      anchorOffset: 36,
    })
    useReaderState.getState().setSidebarScrollPosition('book-1', 'ai', {
      top: 500,
      pinnedToBottom: true,
    })
    expect(useReaderState.getState().sidebarScrollPositions['book-1']).toEqual({
      notes: { top: 120, anchorId: 'note-2', anchorOffset: 36, sessionId: READER_SESSION_ID },
      ai: { top: 500, pinnedToBottom: true, sessionId: READER_SESSION_ID },
    })
  })
})
