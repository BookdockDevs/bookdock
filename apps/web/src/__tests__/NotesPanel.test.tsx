import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import type { AnnotationRes } from '@bookdock/shared'

import { useReaderApi } from '../features/reader/hooks/useReaderApi'
import { NotesPanel } from '../features/reader/components/NotesPanel'

const display = vi.fn()

vi.mock('../features/reader/hooks/useReaderApi', () => ({
  useReaderApi: vi.fn(),
}))

const deleteMutate = vi.fn()
const updateMutate = vi.fn()

vi.mock('../features/reader/hooks/useAnnotations', () => ({
  useDeleteAnnotation: () => ({ mutate: deleteMutate }),
  useUpdateAnnotation: () => ({ mutate: updateMutate }),
}))

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return { ...original, useBookReadingRecords: () => ({ data: undefined }) }
})

function makeAnnotation(overrides: Partial<AnnotationRes>): AnnotationRes {
  return {
    id: 'x',
    bookId: 'book-1',
    cfiRange: 'cfi:0',
    cfiAnchor: null,
    type: 'highlight',
    color: 'yellow',
    style: 'underline',
    text: '',
    note: null,
    chapter: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const ANNOTATIONS: AnnotationRes[] = [
  makeAnnotation({ id: 'h1', cfiRange: 'cfi:1', text: '直线划线甲', color: 'yellow', style: 'underline', chapter: '第一章', createdAt: 1000 }),
  makeAnnotation({ id: 'h2', cfiRange: 'cfi:2', text: '波浪划线乙', color: 'red', style: 'squiggly', chapter: '第二章', createdAt: 2000 }),
  makeAnnotation({ id: 'n1', cfiRange: 'cfi:3', type: 'note', text: '想法原文丙', note: '我的想法丙', color: 'blue', style: 'highlight', chapter: '第一章', createdAt: 3000 }),
  makeAnnotation({ id: 'b1', cfiRange: 'cfi:4', cfiAnchor: 'cfi:4', type: 'bookmark', text: '书签丁', chapter: '第二章', createdAt: 4000 }),
  makeAnnotation({ id: 'h3', cfiRange: 'cfi:5', text: '无章节划线', color: 'green', style: 'highlight', chapter: null, createdAt: 5000 }),
]

function renderPanel(onClose = vi.fn(), sort: 'chapter' | 'time-desc' | 'time-asc' = 'chapter') {
  return render(
    <NotesPanel items={ANNOTATIONS} total={ANNOTATIONS.length} sort={sort} onClose={onClose} chapterOrder={['第一章', '第二章']} bookId="book-1" />,
  )
}

describe('NotesPanel', () => {
  beforeEach(() => {
    vi.mocked(useReaderApi).mockReturnValue({ renderer: { display } })
    display.mockClear()
    deleteMutate.mockClear()
    updateMutate.mockClear()
  })

  it('groups items by chapter in book order with uncategorized last', () => {
    const { container } = renderPanel()
    const headers = Array.from(container.querySelectorAll('.font-semibold')).map((el) => el.textContent)
    expect(headers).toEqual(['第一章', '第二章', 'reader.uncategorized'])
    expect(screen.getByText('直线划线甲')).toBeInTheDocument()
    expect(screen.getByText('我的想法丙')).toBeInTheDocument()
    expect(screen.getByText('书签丁')).toBeInTheDocument()
  })

  it('renders the idea card with note text and the quoted source', () => {
    renderPanel()
    expect(screen.getByText('我的想法丙')).toBeInTheDocument()
    expect(screen.getByText('想法原文丙')).toBeInTheDocument()
  })

  it('renders highlight text with the decoration matching its style', () => {
    renderPanel()
    const squiggly = screen.getByText('波浪划线乙')
    expect(squiggly.getAttribute('style')).toContain('wavy')
    expect(squiggly.getAttribute('style')).toContain('rgb(239, 68, 68)')
    const tinted = screen.getByText('无章节划线')
    expect(tinted.getAttribute('style')).toContain('background-color')
  })

  it('shows the empty hint when there are no items', () => {
    render(<NotesPanel items={[]} total={0} sort="chapter" chapterOrder={[]} bookId="book-1" />)
    expect(screen.getByText('reader.noNotes')).toBeInTheDocument()
  })

  it('navigates on click and closes the panel when not locked', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.click(screen.getByText('直线划线甲'))
    expect(display).toHaveBeenCalledWith('cfi:1')
    expect(onClose).toHaveBeenCalled()
    // bookmarks navigate by their anchor
    fireEvent.click(screen.getByText('书签丁'))
    expect(display).toHaveBeenCalledWith('cfi:4')
  })

  it('renders a flat time-sorted list without chapter headers', () => {
    const { container } = renderPanel(vi.fn(), 'time-desc')
    expect(container.querySelector('.font-semibold')).toBeNull()
    const first = container.querySelector('ul li')
    expect(first?.textContent).toContain('无章节划线')
  })

  it('renames a bookmark via the context menu', () => {
    vi.stubGlobal('prompt', vi.fn(() => '我的书签'))
    renderPanel()
    fireEvent.contextMenu(screen.getByText('书签丁'))
    fireEvent.click(screen.getByText('annotation.rename'))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'b1', body: { text: '我的书签' } })
  })

  it('deletes any item via the context menu', () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('直线划线甲'))
    expect(screen.queryByText('annotation.rename')).toBeNull()
    fireEvent.click(screen.getByText('reader.delete'))
    expect(deleteMutate).toHaveBeenCalledWith('h1')
  })

  it('closes the context menu on a content-click relayed from the reading area', () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('直线划线甲'))
    expect(screen.getByText('annotation.copy')).toBeInTheDocument()
    fireEvent(document, new CustomEvent('content-click', { bubbles: true }))
    expect(screen.queryByText('annotation.copy')).toBeNull()
  })

  it('keeps the context menu open when clicking inside it', () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('直线划线甲'))
    fireEvent.mouseDown(screen.getByText('annotation.copy'))
    expect(screen.getByText('annotation.copy')).toBeInTheDocument()
  })

  it('offers copy in the context menu for any item', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    fireEvent.contextMenu(screen.getByText('我的想法丙'))
    fireEvent.click(screen.getByText('annotation.copy'))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('我的想法丙'))
  })

  it('reveals time and action buttons on hover', () => {
    const recent = [
      makeAnnotation({ id: 'h9', cfiRange: 'cfi:9', text: '最近的划线', createdAt: Date.now() - 3 * 24 * 3600 * 1000 }),
    ]
    render(<NotesPanel items={recent} total={1} sort="chapter" onClose={vi.fn()} chapterOrder={[]} bookId="book-1" />)
    expect(screen.getByText('annotation.timeDaysAgo')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.copy')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.deleteHighlight')).toBeInTheDocument()
    // rename is bookmark-only
    expect(screen.queryByTitle('annotation.rename')).toBeNull()
  })

  it('shows the rename action on bookmark cards', () => {
    renderPanel()
    const bookmarkCard = screen.getByText('书签丁').closest('.group')!
    expect(bookmarkCard.querySelector('[title="annotation.rename"]')).not.toBeNull()
  })
})
