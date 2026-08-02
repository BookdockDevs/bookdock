import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { NavigationPanel } from '../features/reader/components/NavigationPanel'
import { useReaderState } from '../features/reader/state/reader-state'
import { useReaderApi } from '../features/reader/hooks/useReaderApi'
import { useAnnotations } from '../features/reader/hooks/useAnnotations'

const display = vi.fn()
const clearSearch = vi.fn()

vi.mock('../features/reader/hooks/useReaderApi', () => ({
  useReaderApi: vi.fn(),
}))

const deleteMutate = vi.fn()
const updateMutate = vi.fn()

vi.mock('../features/reader/hooks/useAnnotations', () => ({
  useAnnotations: vi.fn(),
  useDeleteAnnotation: () => ({ mutate: deleteMutate }),
  useUpdateAnnotation: () => ({ mutate: updateMutate }),
}))

vi.mock('../features/reader/hooks/useBookChapters', () => ({
  useBookChapters: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return { ...original, useBookReadingRecords: () => ({ data: undefined }) }
})

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})

describe('NavigationPanel', () => {
  beforeEach(() => {
    vi.mocked(useReaderApi).mockReturnValue({ renderer: { display, clearSearch } })
    vi.mocked(useAnnotations).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useAnnotations>)
    window.localStorage.removeItem('bd-notes-display-types')
    display.mockClear()
    deleteMutate.mockClear()
    updateMutate.mockClear()
    useReaderState.setState({
      activeNavTab: 'toc',
      tocItems: [],
      currentChapter: null,
      selection: null,
    })
  })

  it('highlights current chapter in TOC', () => {
    useReaderState.setState({
      tocItems: [
        { label: '第一章 开篇', href: 'chapter:0' },
        { label: '第二章 续篇', href: 'chapter:1' },
      ],
      currentChapter: '第二章 续篇',
    })

    render(<NavigationPanel bookId="book-1" open />)

    const currentButton = screen.getByRole('button', { name: '第二章 续篇' })
    expect(currentButton).toHaveClass('font-medium')
  })

  it('scrolls current chapter into view when panel opens', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    useReaderState.setState({
      tocItems: [
        { label: '第一章 开篇', href: 'chapter:0' },
        { label: '第二章 续篇', href: 'chapter:1' },
      ],
      currentChapter: '第二章 续篇',
    })

    render(<NavigationPanel bookId="book-1" open />)

    await new Promise((r) => setTimeout(r, 300))
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('navigates to clicked chapter', () => {
    useReaderState.setState({
      tocItems: [{ label: '第一章 开篇', href: 'chapter:0' }],
    })

    render(<NavigationPanel bookId="book-1" open />)
    fireEvent.click(screen.getByText('第一章 开篇'))

    expect(display).toHaveBeenCalledWith('chapter:0')
  })

  it('closes sidebar after navigation when not locked', () => {
    useReaderState.setState({
      tocItems: [{ label: '第一章 开篇', href: 'chapter:0' }],
    })

    const onClose = vi.fn()
    render(<NavigationPanel bookId="book-1" open onClose={onClose} />)
    fireEvent.click(screen.getByText('第一章 开篇'))

    expect(onClose).toHaveBeenCalled()
  })

  it('keeps sidebar open after navigation when locked', () => {
    useReaderState.setState({
      tocItems: [{ label: '第一章 开篇', href: 'chapter:0' }],
    })

    const onClose = vi.fn()
    render(<NavigationPanel bookId="book-1" open locked onClose={onClose} />)
    fireEvent.click(screen.getByText('第一章 开篇'))

    expect(display).toHaveBeenCalledWith('chapter:0')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('highlights current chapter by index when currentChapterIndex is set', () => {
    useReaderState.setState({
      tocItems: [
        { label: '第一章 开篇', href: 'chapter:0' },
        { label: '第二章 续篇', href: 'chapter:1' },
      ],
      currentChapterIndex: 1,
    })

    render(<NavigationPanel bookId="book-1" open />)

    const currentButton = screen.getByRole('button', { name: '第二章 续篇' })
    expect(currentButton).toHaveClass('font-medium')
  })

  it('auto-expands nested path and scrolls to current chapter', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    useReaderState.setState({
      tocItems: [
        { label: '第一卷', href: 'chapter:0', level: 1 },
        { label: '第一章 开篇', href: 'chapter:1', level: 2 },
        { label: '第二章 续篇', href: 'chapter:2', level: 2 },
        { label: '第二卷', href: 'chapter:3', level: 1 },
        { label: '第三章 深入', href: 'chapter:4', level: 2 },
      ],
      currentChapterIndex: 4,
    })

    render(<NavigationPanel bookId="book-1" open />)

    // The current chapter and its ancestor should be visible after auto-expansion.
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByRole('button', { name: '第三章 深入' })).toHaveClass('font-medium')
    expect(screen.getByText('第二卷')).toBeInTheDocument()
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('restores TOC scroll position after switching to notes and back', async () => {
    const originalGetBoundingClientRect = window.HTMLElement.prototype.getBoundingClientRect
    let callCount = 0
    window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const rect = originalGetBoundingClientRect.call(this)
      // The list container has overflow-y-auto; return a tall viewport.
      if (this.classList.contains('overflow-y-auto')) {
        return { ...rect, top: 0, left: 0, width: 300, height: 400, bottom: 400, right: 300 } as DOMRect
      }
      // TOC item buttons: current item sits far down the list.
      return { ...rect, top: 800 + callCount++, left: 0, width: 280, height: 30, bottom: 830, right: 280 } as DOMRect
    }

    try {
      await act(async () => {
        useReaderState.setState({
          tocItems: Array.from({ length: 30 }, (_, i) => ({ label: `第${i + 1}章`, href: `chapter:${i}` })),
          currentChapter: '第15章',
        })
      })

      const panelRef = createRef<{ saveScroll: () => void }>()
      const { container } = render(<NavigationPanel ref={panelRef} bookId="book-1" open />)

      await act(async () => {
        await new Promise((r) => setTimeout(r, 350))
      })

      const listContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement
      expect(listContainer).toBeTruthy()

      // User manually scrolls to a different position.
      await act(() => {
        listContainer.scrollTop = 123
        fireEvent.scroll(listContainer)
      })

      // Switch to notes and back to TOC through the imperative saveScroll API.
      await act(() => {
        panelRef.current?.saveScroll()
        useReaderState.setState({ activeNavTab: 'notes' })
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      await act(() => {
        panelRef.current?.saveScroll()
        useReaderState.setState({ activeNavTab: 'toc' })
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350))
      })

      expect(listContainer.scrollTop).toBe(123)
    } finally {
      window.HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  describe('book search overlay', () => {
    const search = vi.fn(async () => [
      { cfi: 'cfi:1', text: '一个高中生说', index: 0, chapter: '第二章 图穷匕见', excerpt: { pre: '一个', match: '高中', post: '生说' } },
      { cfi: 'cfi:2', text: '总武高中一年级', index: 1, chapter: '第二章 图穷匕见', excerpt: { pre: '总武', match: '高中', post: '一年级' } },
      { cfi: 'cfi:3', text: '出现在高中。', index: 2, chapter: '第五章 死鱼眼', excerpt: { pre: '出现在', match: '高中', post: '。' } },
    ])

    beforeEach(() => {
      search.mockClear()
      vi.mocked(useReaderApi).mockReturnValue({ renderer: { display, search, clearSearch } })
      useReaderState.setState({
        tocItems: [
          { label: '第一章 开篇', href: 'chapter:0' },
          { label: '第二章 图穷匕见', href: 'chapter:1' },
        ],
      })
    })

    it('expands the search bar from the header icon and overlays grouped results', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      const input = screen.getByPlaceholderText('reader.searchPlaceholder')
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-0')
      fireEvent.click(screen.getByTitle('reader.search'))
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-16')
      fireEvent.change(input, { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))

      expect(search).toHaveBeenCalledWith('高中', { scope: 'book', matchCase: false, mode: 'contains' }, expect.any(Function))
      // consecutive results from the same chapter collapse into one group
      expect(screen.getByText('第二章 图穷匕见')).toBeInTheDocument()
      expect(screen.getByText('第五章 死鱼眼')).toBeInTheDocument()
      expect(screen.getAllByText('高中')).toHaveLength(3)
      // TOC list is replaced by the overlay
      expect(screen.queryByText('第一章 开篇')).toBeNull()
    })

    it('navigates to a result and closes the panel on click', async () => {
      const onClose = vi.fn()
      render(<NavigationPanel bookId="book-1" open onClose={onClose} />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(screen.getByPlaceholderText('reader.searchPlaceholder'), { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))

      // click the highlighted match — the click bubbles up to the result button
      fireEvent.click(screen.getAllByText('高中')[1])
      expect(display).toHaveBeenCalledWith('cfi:2')
      expect(onClose).toHaveBeenCalled()
    })

    it('returns to the TOC list after clearing the query', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(screen.getByPlaceholderText('reader.searchPlaceholder'), { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))
      expect(screen.queryByText('第一章 开篇')).toBeNull()

      fireEvent.click(screen.getByLabelText('清除'))
      expect(screen.getByText('第一章 开篇')).toBeInTheDocument()
    })

    it('keeps the query and results when collapsing and reopening the bar', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      const input = screen.getByPlaceholderText('reader.searchPlaceholder')
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(input, { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))
      expect(search).toHaveBeenCalledTimes(1)
      expect(screen.getAllByText('高中')).toHaveLength(3)

      // collapse: the bar hides and the TOC returns, but nothing is discarded
      fireEvent.click(screen.getByTitle('reader.search'))
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-0')
      expect(screen.getByText('第一章 开篇')).toBeInTheDocument()

      // reopen: query and results are restored instantly, without re-searching
      fireEvent.click(screen.getByTitle('reader.search'))
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-16')
      expect(input).toHaveValue('高中')
      expect(screen.getAllByText('高中')).toHaveLength(3)
      expect(search).toHaveBeenCalledTimes(1)
    })

    it('streams partial results with a progress indicator while searching', async () => {
      const partial = [
        { cfi: 'cfi:1', text: '一个高中生说', index: 0, chapter: '第二章 图穷匕见', excerpt: { pre: '一个', match: '高中', post: '生说' } },
      ]
      const full = [
        ...partial,
        { cfi: 'cfi:2', text: '出现在高中。', index: 1, chapter: '第五章 死鱼眼', excerpt: { pre: '出现在', match: '高中', post: '。' } },
      ]
      let resolveSearch!: (value: unknown) => void
      const streamingSearch = vi.fn(
        (_query: string, _opts: unknown, onProgress?: (results: unknown[], progress: number | null) => void) => {
          onProgress?.(partial, 0.5)
          return new Promise((resolve) => {
            resolveSearch = resolve
          })
        },
      )
      vi.mocked(useReaderApi).mockReturnValue({ renderer: { display, search: streamingSearch, clearSearch } })
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(screen.getByPlaceholderText('reader.searchPlaceholder'), { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))

      // partial results and the progress bar are visible before completion
      expect(screen.getAllByText('高中')).toHaveLength(1)
      expect(screen.getByTestId('search-progress').style.width).toBe('50%')

      await act(async () => {
        resolveSearch(full)
      })
      expect(screen.getAllByText('高中')).toHaveLength(2)
      expect(screen.queryByTestId('search-progress')).toBeNull()
    })

    it('closes the options menu when clicking the search input', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.click(screen.getByTitle('reader.searchOptions'))
      expect(screen.getByText('reader.searchModeRegex')).toBeInTheDocument()

      fireEvent.mouseDown(screen.getByPlaceholderText('reader.searchPlaceholder'))
      expect(screen.queryByText('reader.searchModeRegex')).toBeNull()
    })

    it('enters search mode from a pending selection query', async () => {
      useReaderState.setState({ pendingSearchQuery: '高中' })
      render(<NavigationPanel bookId="book-1" open />)
      await new Promise((r) => setTimeout(r, 500))

      expect(screen.getByPlaceholderText('reader.searchPlaceholder')).toHaveValue('高中')
      expect(search).toHaveBeenCalled()
      expect(useReaderState.getState().pendingSearchQuery).toBeNull()
    })

    it('shows the result nav card and cycles results with prev/next', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(screen.getByPlaceholderText('reader.searchPlaceholder'), { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))

      expect(screen.getByText('reader.searchResultsFor')).toBeInTheDocument()
      expect(screen.getByText('1/3')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('reader.next'))
      expect(display).toHaveBeenCalledWith('cfi:2')
      expect(screen.getByText('2/3')).toBeInTheDocument()

      // wraps around to the last result
      fireEvent.click(screen.getByTitle('reader.prev'))
      fireEvent.click(screen.getByTitle('reader.prev'))
      expect(display).toHaveBeenCalledWith('cfi:3')
      expect(screen.getByText('3/3')).toBeInTheDocument()
    })

    it('hides the nav card and resets the search via its close button', async () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(screen.getByPlaceholderText('reader.searchPlaceholder'), { target: { value: '高中' } })
      await new Promise((r) => setTimeout(r, 500))
      expect(screen.getByText('reader.searchResultsFor')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('annotation.cancel'))
      expect(screen.queryByText('reader.searchResultsFor')).toBeNull()
      expect(screen.getByText('第一章 开篇')).toBeInTheDocument()
    })
  })

  describe('notes tab search and filter', () => {
    const notesAnnotations = [
      { id: 'h1', bookId: 'book-1', type: 'highlight', color: 'yellow', style: 'underline', text: '直线划线甲', note: null, chapter: '第一章', cfiRange: 'cfi:1', cfiAnchor: null, createdAt: 1000, updatedAt: 1000 },
      { id: 'n1', bookId: 'book-1', type: 'note', color: 'blue', style: 'highlight', text: '想法原文丙', note: '我的想法丙', chapter: '第一章', cfiRange: 'cfi:2', cfiAnchor: null, createdAt: 2000, updatedAt: 2000 },
      { id: 'b1', bookId: 'book-1', type: 'bookmark', color: 'yellow', style: 'underline', text: '书签丁', chapter: '第二章', cfiRange: 'cfi:3', cfiAnchor: 'cfi:3', createdAt: 3000, updatedAt: 3000 },
    ]

    beforeEach(() => {
      vi.mocked(useAnnotations).mockReturnValue({ data: { data: notesAnnotations } } as unknown as ReturnType<typeof useAnnotations>)
      useReaderState.setState({ activeNavTab: 'notes' })
    })

    it('expands the search bar from the header icon and filters the list', () => {
      render(<NavigationPanel bookId="book-1" open />)
      const input = screen.getByPlaceholderText('reader.noteSearchPlaceholder')
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-0')
      fireEvent.click(screen.getByTitle('reader.search'))
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-16')
      fireEvent.change(input, { target: { value: '想法丙' } })
      expect(screen.getByText('我的想法丙')).toBeInTheDocument()
      expect(screen.queryByText('直线划线甲')).toBeNull()
    })

    it('opens the filter panel from the header funnel and closes on outside click', () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('annotation.filter'))
      expect(screen.getByText('annotation.filterColor')).toBeInTheDocument()
      // sort options live inside the filter panel now
      expect(screen.getByText('reader.sortChapter')).toBeInTheDocument()

      fireEvent.mouseDown(document.body)
      expect(screen.queryByText('annotation.filterColor')).toBeNull()
    })

    it('filters displayed kinds via the header funnel and persists the choice', () => {
      render(<NavigationPanel bookId="book-1" open />)
      fireEvent.click(screen.getByTitle('annotation.filter'))
      fireEvent.click(screen.getByText('annotation.idea'))
      expect(screen.queryByText('我的想法丙')).toBeNull()
      expect(screen.getByText('直线划线甲')).toBeInTheDocument()
      expect(window.localStorage.getItem('bd-notes-display-types')).toBe('["highlight","bookmark"]')

      // toggle it back on
      fireEvent.click(screen.getByText('annotation.idea'))
      expect(screen.getByText('我的想法丙')).toBeInTheDocument()
    })

    it('collapses the bar, clears the query and closes the filter panel', () => {
      render(<NavigationPanel bookId="book-1" open />)
      const input = screen.getByPlaceholderText('reader.noteSearchPlaceholder')
      fireEvent.click(screen.getByTitle('reader.search'))
      fireEvent.change(input, { target: { value: '想法丙' } })
      fireEvent.click(screen.getByTitle('annotation.filter'))
      expect(screen.getByText('annotation.filterColor')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('reader.search'))
      expect(input.closest('div.overflow-hidden')).toHaveClass('max-h-0')
      expect(screen.queryByText('annotation.filterColor')).toBeNull()
      expect(screen.getByText('直线划线甲')).toBeInTheDocument()
    })
  })
})
