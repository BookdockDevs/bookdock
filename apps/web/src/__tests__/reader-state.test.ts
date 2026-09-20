import { beforeEach, describe, expect, it } from 'vitest'

import { useReaderState } from '../features/reader/state/reader-state'

describe('reader-state resetForBook', () => {
  beforeEach(() => {
    useReaderState.setState({ sidebarOpen: true, activeNavTab: 'notes', selection: null })
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
})
