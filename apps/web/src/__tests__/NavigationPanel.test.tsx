import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { NavigationPanel } from '../features/reader/components/NavigationPanel'
import { useReaderState } from '../features/reader/state/reader-state'
import { useReaderApi } from '../features/reader/hooks/useReaderApi'
import { useAnnotations } from '../features/reader/hooks/useAnnotations'

const display = vi.fn()

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

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})

describe('NavigationPanel', () => {
  beforeEach(() => {
    vi.mocked(useReaderApi).mockReturnValue({ renderer: { display } })
    vi.mocked(useAnnotations).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useAnnotations>)
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

    const currentButton = screen.getByText('第二章 续篇')
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

    const currentButton = screen.getByText('第二章 续篇')
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
    expect(screen.getByText('第三章 深入')).toHaveClass('font-medium')
    expect(screen.getByText('第二卷')).toBeInTheDocument()
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('groups bookmarks by chapter', () => {
    vi.mocked(useAnnotations).mockReturnValue({
      data: {
        data: [
          { id: 'b1', type: 'bookmark', cfiRange: 'chapter:0', cfiAnchor: 'chapter:0', text: '第一章上下文', chapter: '第一章 开篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
          { id: 'b2', type: 'bookmark', cfiRange: 'chapter:1', cfiAnchor: 'chapter:1', text: '第二章上下文', chapter: '第二章 续篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
          { id: 'b3', type: 'bookmark', cfiRange: 'chapter:2', cfiAnchor: 'chapter:2', text: '第二章另一处', chapter: '第二章 续篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
      },
    } as ReturnType<typeof useAnnotations>)

    useReaderState.setState({ activeNavTab: 'bookmarks' })
    render(<NavigationPanel bookId="book-1" open />)

    expect(screen.getByText('第一章 开篇')).toBeInTheDocument()
    expect(screen.getByText('第二章 续篇')).toBeInTheDocument()
    expect(screen.getByText('第一章上下文')).toBeInTheDocument()
    expect(screen.getByText('第二章上下文')).toBeInTheDocument()
    expect(screen.getByText('第二章另一处')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('puts bookmarks without chapter into uncategorized group', () => {
    vi.mocked(useAnnotations).mockReturnValue({
      data: {
        data: [
          { id: 'b1', type: 'bookmark', cfiRange: 'chapter:0', cfiAnchor: 'chapter:0', text: '无章节上下文', chapter: null, createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
      },
    } as ReturnType<typeof useAnnotations>)

    useReaderState.setState({ activeNavTab: 'bookmarks' })
    render(<NavigationPanel bookId="book-1" open />)

    expect(screen.getByText('未分类')).toBeInTheDocument()
    expect(screen.getByText('无章节上下文')).toBeInTheDocument()
  })

  it('toggles bookmark group expansion', async () => {
    vi.mocked(useAnnotations).mockReturnValue({
      data: {
        data: [
          { id: 'b1', type: 'bookmark', cfiRange: 'chapter:0', cfiAnchor: 'chapter:0', text: '第一章上下文', chapter: '第一章 开篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
      },
    } as ReturnType<typeof useAnnotations>)

    useReaderState.setState({ activeNavTab: 'bookmarks' })
    render(<NavigationPanel bookId="book-1" open />)

    const groupButton = screen.getByTestId('bookmark-group-第一章 开篇')
    expect(groupButton).toBeInTheDocument()
    expect(screen.getByText('第一章上下文')).toBeInTheDocument()

    fireEvent.click(groupButton)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('第一章上下文')).not.toBeInTheDocument()

    fireEvent.click(groupButton)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('第一章上下文')).toBeInTheDocument()
  })

  it('shows context menu to delete all bookmarks in a group', () => {
    vi.mocked(useAnnotations).mockReturnValue({
      data: {
        data: [
          { id: 'b1', type: 'bookmark', cfiRange: 'chapter:0', cfiAnchor: 'chapter:0', text: '第一章上下文', chapter: '第一章 开篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
          { id: 'b2', type: 'bookmark', cfiRange: 'chapter:1', cfiAnchor: 'chapter:1', text: '第一章另一处', chapter: '第一章 开篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
      },
    } as ReturnType<typeof useAnnotations>)

    vi.stubGlobal('confirm', vi.fn(() => true))
    useReaderState.setState({ activeNavTab: 'bookmarks' })
    render(<NavigationPanel bookId="book-1" open />)

    const groupButton = screen.getByTestId('bookmark-group-第一章 开篇')
    fireEvent.contextMenu(groupButton)

    expect(screen.getByText('删除本章全部书签')).toBeInTheDocument()
    fireEvent.click(screen.getByText('删除本章全部书签'))

    expect(deleteMutate).toHaveBeenCalledTimes(2)
    expect(deleteMutate).toHaveBeenCalledWith('b1')
    expect(deleteMutate).toHaveBeenCalledWith('b2')
  })

  it('restores TOC scroll position after switching to bookmarks and back', async () => {
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

      // Switch to bookmarks and back to TOC through the imperative saveScroll API.
      await act(() => {
        panelRef.current?.saveScroll()
        useReaderState.setState({ activeNavTab: 'bookmarks' })
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

  it('shows context menu to rename and delete a single bookmark', () => {
    vi.mocked(useAnnotations).mockReturnValue({
      data: {
        data: [
          { id: 'b1', type: 'bookmark', cfiRange: 'chapter:0', cfiAnchor: 'chapter:0', text: '第一章上下文', chapter: '第一章 开篇', createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
      },
    } as ReturnType<typeof useAnnotations>)

    vi.stubGlobal('prompt', vi.fn(() => '我的书签'))
    useReaderState.setState({ activeNavTab: 'bookmarks' })
    render(<NavigationPanel bookId="book-1" open />)

    const itemText = screen.getByText('第一章上下文')
    fireEvent.contextMenu(itemText)

    expect(screen.getByText('重命名')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()

    fireEvent.click(screen.getByText('重命名'))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'b1', body: { text: '我的书签' } })

    fireEvent.contextMenu(itemText)
    fireEvent.click(screen.getByText('删除'))
    expect(deleteMutate).toHaveBeenCalledWith('b1')
  })
})
