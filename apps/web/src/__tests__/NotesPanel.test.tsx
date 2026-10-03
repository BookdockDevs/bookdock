import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'

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
    chapterHref: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const ANNOTATIONS: AnnotationRes[] = [
  makeAnnotation({ id: 'h1', cfiRange: 'cfi:1', text: '直线划线甲', color: 'yellow', style: 'underline', chapter: '第一章', createdAt: 1000 }),
  makeAnnotation({ id: 'h2', cfiRange: 'cfi:2', text: '波浪划线乙', color: 'red', style: 'squiggly', chapter: '第二章', createdAt: 2000 }),
  makeAnnotation({ id: 'n1', cfiRange: 'cfi:3', type: 'note', text: '想法原文丙', note: '我的想法丙', color: 'blue', style: 'highlight', chapter: '第一章', createdAt: 3000 }),
  makeAnnotation({ id: 'b1', cfiRange: 'cfi:4', cfiAnchor: 'cfi-anchor', type: 'bookmark', text: '书签丁', chapter: '第二章', createdAt: 4000 }),
  makeAnnotation({ id: 'h3', cfiRange: 'cfi:5', text: '无章节划线', color: 'green', style: 'highlight', chapter: null, createdAt: 5000 }),
]

function renderPanel(onClose = vi.fn(), sort: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc' = 'chapter') {
  return render(
    <NotesPanel items={ANNOTATIONS} total={ANNOTATIONS.length} sort={sort} onClose={onClose} chapterOrder={[{ label: '第一章', href: 'chapter:1' }, { label: '第二章', href: 'chapter:2' }]} bookId="book-1" />,
  )
}

describe('bookmark cards', () => {
  // A bookmark always captures 80 characters, so its card has to be able to
  // show them and has to offer the same expand affordance the other kinds have.
  beforeEach(() => {
    vi.mocked(useReaderApi).mockReturnValue({
      renderer: { display, pushPopupGuard: vi.fn(), popPopupGuard: vi.fn() },
    })
    display.mockClear()
    deleteMutate.mockClear()
    updateMutate.mockClear()
  })

  const LONG = '他走进屋子看见桌上放着一封信信封上没有任何署名窗外传来巷口小贩的叫卖声'
    + '他停在门口犹豫了很久最终还是没有伸手去拿而是转身走向窗边看着外面熙攘的人群和暮色中的屋檐'
  expect(LONG.length).toBe(79)

  function renderOne(overrides: Partial<AnnotationRes>, sort: 'chapter' | 'time-desc' = 'time-desc') {
    const item = makeAnnotation({ id: 'bm', type: 'bookmark', cfiAnchor: 'cfi-anchor', ...overrides })
    return render(
      <NotesPanel items={[item]} total={1} sort={sort} onClose={vi.fn()} chapterOrder={[{ label: '第三章', href: 'chapter:3' }]} bookId="book-1" />,
    )
  }

  it('shows bookmark context independently of the renamed title', () => {
    renderOne({ text: 'Renamed title', contextText: 'First paragraph\n\nSecond paragraph' })
    expect(screen.getByText('Renamed title')).toBeTruthy()
    const context = screen.getByText(/First paragraph/)
    const block = context.closest('p')!
    expect(Array.from(block.querySelectorAll('[data-note-paragraph]')).map((el) => el.textContent)).toEqual(['First paragraph', 'Second paragraph'])
    expect(block.className).toContain('whitespace-pre-wrap')
    expect(block.className).toContain('line-clamp-3')
  })

  it('renders single clean excerpt without duplicating prefix title when bookmark is not renamed', () => {
    renderOne({
      text: '清晨的阳光透过窗棂洒在书桌上，微风轻轻吹拂着窗纱',
      contextText: '清晨的阳光透过窗棂洒在书桌上，微风轻轻吹拂着窗纱，屋子里弥漫着淡淡的花香与草木气息…',
    })
    const elements = screen.getAllByText(/清晨的阳光透过窗棂洒在书桌上/)
    expect(elements).toHaveLength(1)
    const block = elements[0].closest('p')!
    expect(block.className).toContain('line-clamp-4')
  })

  it('uses compact paragraph gaps without highlighting blank separators', () => {
    const { container } = renderOne({ type: 'highlight', style: 'highlight', text: '第一段\n\n第二段\n行内换行' })
    const paragraphs = container.querySelectorAll('[data-note-paragraph]')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1].className).toContain('mt-[0.4em]')
    expect(paragraphs[1].textContent).toBe('第二段\n行内换行')
    const decorated = Array.from(container.querySelectorAll('p span[style]')).filter((el) => (el as HTMLElement).style.backgroundColor)
    expect(decorated.map((el) => el.textContent)).toEqual(['第一段', '第二段', '行内换行'])
    expect(decorated.every((el) => !el.textContent?.includes('\n'))).toBe(true)
  })

  it('gives the snippet four lines, not two', () => {
    const { container } = renderOne({ text: LONG })
    const snippet = screen.getByText(LONG)
    expect(snippet.className).toContain('line-clamp-4')
    expect(snippet.className).not.toContain('line-clamp-2')
    expect(container).toBeTruthy()
  })

  it('offers expand once the snippet passes the same threshold as a highlight', () => {
    renderOne({ text: LONG })
    const expand = screen.getByText('annotation.expand')
    fireEvent.click(expand)

    expect(screen.getByText(LONG).className).not.toContain('line-clamp-4')
    expect(screen.getByText('annotation.collapse')).toBeTruthy()
  })

  // The reported symptom: widening the panel made all 80 characters fit, yet
  // the toggle stayed, and expanding it revealed only the padding the button
  // reserves for itself. Whether text is cut off is a question about the
  // rendered box, so these drive the measurement directly.
  function stubResizeObserver() {
    const seen: Array<() => void> = []
    class FakeResizeObserver {
      constructor(cb: () => void) { seen.push(cb) }
      observe() { /* the test fires the callback itself */ }
      unobserve() { /* not used */ }
      disconnect() { /* not used */ }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    return () => seen.at(-1)?.()
  }

  function layout(snippet: HTMLElement, client: number, scroll: number) {
    Object.defineProperty(snippet, 'clientHeight', { configurable: true, value: client })
    Object.defineProperty(snippet, 'scrollHeight', { configurable: true, value: scroll })
  }

  it('drops the toggle once the box reports no overflow', () => {
    const notifyResize = stubResizeObserver()
    const { container } = renderOne({ text: LONG })
    layout(screen.getByText(LONG), 64, 64)

    act(() => { notifyResize() })

    expect(container.innerHTML).not.toContain('annotation.expand')
    expect(container.innerHTML).not.toContain('annotation.collapse')
  })

  it('keeps the toggle while the box is still clipped', () => {
    const notifyResize = stubResizeObserver()
    const { container } = renderOne({ text: LONG })
    layout(screen.getByText(LONG), 64, 128)

    act(() => { notifyResize() })

    expect(container.innerHTML).toContain('annotation.expand')
  })

  it('reserves no button padding when the snippet is not clipped', () => {
    // The empty line came from padding held for a button that had nothing to
    // reveal, so neither may appear when the box is not clipped.
    const notifyResize = stubResizeObserver()
    const { container } = renderOne({ text: LONG })
    layout(screen.getByText(LONG), 64, 64)

    act(() => { notifyResize() })

    expect(container.innerHTML).not.toContain('pb-5')
  })

  it('holds the toggle once expanded so the snippet can be folded back', () => {
    const notifyResize = stubResizeObserver()
    const { container } = renderOne({ text: LONG })
    layout(screen.getByText(LONG), 64, 128)
    act(() => { notifyResize() })

    fireEvent.click(screen.getByText('annotation.expand'))

    // The collapse action stays available without reserving another line.
    expect(container.innerHTML).toContain('annotation.collapse')
    expect(container.innerHTML).not.toContain('pb-5')
  })

  it('leaves a short snippet alone', () => {
    renderOne({ text: '很短的书签' })
    expect(screen.queryByText('annotation.expand')).toBeNull()
    expect(screen.getByText('很短的书签').className).toContain('line-clamp-4')
  })

  it('labels the chapter in time sort so a position is recognizable via chapter header', () => {
    const { container } = renderOne({ text: LONG, chapter: '第三章' })
    expect(container.querySelector('button[title="第三章"]')?.textContent).toBe('第三章')
  })

  it('drops the per-card chapter when the list is already grouped by it', () => {
    const { container } = renderOne({ text: LONG, chapter: '第三章' }, 'chapter')
    // The group header carries it instead, so repeating it per card is noise.
    expect(container.querySelector('.group\\/time')?.closest('div')?.querySelector('span[title="第三章"]')).toBeNull()
    expect(screen.getByText('第三章')).toBeTruthy()
  })
})

describe('NotesPanel', () => {
  beforeEach(() => {
    vi.mocked(useReaderApi).mockReturnValue({
      renderer: { display, pushPopupGuard: vi.fn(), popPopupGuard: vi.fn() },
    })
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

  it('uses a compact hover overlay for idea quotes and keeps expansion working', () => {
    const text = 'Quoted source paragraph. '.repeat(12)
    render(<NotesPanel items={[makeAnnotation({ type: 'note', text, note: 'Idea' })]} total={1} sort="time-desc" onClose={vi.fn()} bookId="book-1" />)
    const button = screen.getByText('annotation.expand').closest('button')!
    expect(button).toHaveClass('absolute', 'group-hover:opacity-100', 'max-md:opacity-100')
    expect(button.previousElementSibling?.tagName).toBe('P')
    fireEvent.click(button)
    expect(screen.getByText('annotation.collapse')).toBeInTheDocument()
    expect(button.parentElement).not.toHaveClass('pb-5')
    expect(screen.getByText(text.trim()).closest('p')).not.toHaveClass('line-clamp-2')
  })

  it('renders highlight text with the decoration matching its style', () => {
    renderPanel()
    const squiggly = screen.getByText('波浪划线乙')
    expect(squiggly.style.backgroundImage).toContain('data:image/svg+xml')
    expect(squiggly.style.backgroundRepeat).toBe('repeat-x')
    expect(squiggly.style.paddingBottom).toBe('4px')
    expect(squiggly.closest('p')).toHaveClass('pb-1')
    expect(decodeURIComponent(squiggly.style.backgroundImage)).toContain('fill="#ef4444"')
    const tinted = screen.getByText('无章节划线')
    expect(tinted.getAttribute('style')).toContain('background-color')
  })

  it('shows the empty hint when there are no items', () => {
    render(<NotesPanel items={[]} total={0} sort="chapter" chapterOrder={[]} bookId="book-1" />)
    expect(screen.getByText('reader.noNotes')).toBeInTheDocument()
  })

  it('waits for chapter order before showing chapter-grouped notes', () => {
    render(
      <NotesPanel
        items={ANNOTATIONS}
        total={ANNOTATIONS.length}
        sort="chapter"
        chapterOrder={[]}
        chapterOrderReady={false}
        bookId="book-1"
      />,
    )
    expect(screen.getByText('reader.loading')).toBeInTheDocument()
    expect(screen.queryByText('直线划线甲')).toBeNull()
  })

  it('keeps duplicate chapter labels in separate groups when hrefs differ', () => {
    const first = makeAnnotation({ id: 'duplicate-1', cfiRange: 'cfi:27-1', text: '第一次同名章节', chapter: '第二十七章', chapterHref: 'chapter:first-27' })
    const second = makeAnnotation({ id: 'duplicate-2', cfiRange: 'cfi:27-2', text: '第二次同名章节', chapter: '第二十七章', chapterHref: 'chapter:second-27' })
    render(
      <NotesPanel
        items={[first, second]}
        total={2}
        sort="chapter"
        chapterOrder={[{ label: '第二十七章', href: 'chapter:first-27' }, { label: '第二十七章', href: 'chapter:second-27' }]}
        bookId="book-1"
      />,
    )
    expect(screen.getAllByRole('button', { name: '第二十七章' })).toHaveLength(2)
    expect(screen.getByText('第一次同名章节')).toBeInTheDocument()
    expect(screen.getByText('第二次同名章节')).toBeInTheDocument()
  })

  it('renders the panel normally without an inline export action', () => {
    renderPanel()
    expect(screen.queryByText('annotation.export')).toBeNull()
  })

  it('navigates on click and closes the panel when not locked', () => {
    const onClose = vi.fn()
    renderPanel(onClose)
    fireEvent.click(screen.getByText('直线划线甲'))
    expect(display).toHaveBeenCalledWith('cfi:1')
    expect(onClose).toHaveBeenCalled()
    // bookmarks navigate by their persisted restore position
    fireEvent.click(screen.getByText('书签丁'))
    expect(display).toHaveBeenCalledWith('cfi:4')
  })

  it('groups consecutive notes by chapter under time sort', () => {
    const { container } = renderPanel(vi.fn(), 'time-desc')
    const headers = Array.from(container.querySelectorAll('button.font-semibold')).map((el) => el.textContent)
    expect(headers).toEqual(['reader.uncategorized', '第二章', '第一章', '第二章', '第一章'])
    const first = container.querySelector('ul li')
    expect(first?.textContent).toContain('无章节划线')
  })

  it('reverses chapter groups and keeps uncategorized items last', () => {
    const { container } = renderPanel(vi.fn(), 'chapter-desc')
    const headers = Array.from(container.querySelectorAll('.font-semibold')).map((el) => el.textContent)
    expect(headers).toEqual(['第二章', '第一章', 'reader.uncategorized'])
    expect(container.querySelector('ul li')?.textContent).toContain('书签丁')
  })

  it('renames a bookmark via the context menu', () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('书签丁'))
    fireEvent.click(screen.getByText('annotation.rename'))
    const textarea = screen.getByPlaceholderText('annotation.renamePlaceholder')
    fireEvent.change(textarea, { target: { value: '我的书签' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'b1', body: { text: '我的书签' } }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('renames a bookmark via the hover pencil and the save button', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.rename'))
    const textarea = screen.getByPlaceholderText('annotation.renamePlaceholder')
    fireEvent.change(textarea, { target: { value: '新书签' } })
    fireEvent.click(screen.getByText('annotation.save'))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'b1', body: { text: '新书签' } }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('edits an idea note inline via the hover pencil', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.editNote'))
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    fireEvent.change(textarea, { target: { value: '新的想法' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'n1', body: { note: '新的想法' } }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('retains the draft on failed save and closes only after a successful retry', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.editNote'))
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    fireEvent.change(textarea, { target: { value: 'Retry-safe draft' } })
    fireEvent.click(screen.getByText('annotation.save'))
    act(() => updateMutate.mock.calls.at(-1)![1].onError(new Error('Offline')))
    expect(textarea).toHaveValue('Retry-safe draft')
    expect(screen.getByRole('alert')).toHaveTextContent('annotation.editSaveFailed')
    fireEvent.click(screen.getByText('annotation.save'))
    act(() => updateMutate.mock.calls.at(-1)![1].onSuccess())
    expect(screen.queryByPlaceholderText('annotation.notePlaceholder')).toBeNull()
  })

  it('cancels an inline edit on Escape without mutating', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.editNote'))
    fireEvent.keyDown(screen.getByPlaceholderText('annotation.notePlaceholder'), { key: 'Escape' })
    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText('我的想法丙')).toBeInTheDocument()
  })

  it('does not save an emptied inline edit', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.rename'))
    const textarea = screen.getByPlaceholderText('annotation.renamePlaceholder')
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText('书签丁')).toBeInTheDocument()
  })

  it('clears custom bookmark title when saved with an empty value', () => {
    const item = makeAnnotation({ id: 'bm-custom', type: 'bookmark', text: '自定义标题', contextText: '这是一段正文内容' })
    render(
      <NotesPanel items={[item]} total={1} sort="chapter" onClose={vi.fn()} chapterOrder={[]} bookId="book-1" />,
    )
    fireEvent.click(screen.getByTitle('annotation.rename'))
    const textarea = screen.getByPlaceholderText('annotation.renamePlaceholder')
    expect(textarea).toHaveValue('自定义标题')
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.click(screen.getByText('annotation.save'))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'bm-custom', body: { text: '' } }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('cancels the inline editor on an outside click', () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('annotation.rename'))
    fireEvent.mouseDown(document.body)
    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText('书签丁')).toBeInTheDocument()
  })

  it('deletes any item via the context menu', () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('直线划线甲'))
    expect(screen.queryByText('annotation.rename')).toBeNull()
    fireEvent.click(screen.getByText('reader.delete'))
    expect(deleteMutate).toHaveBeenCalledWith('h1', expect.objectContaining({ onError: expect.any(Function) }))
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
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('我的想法丙\n\n想法原文丙'))
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

  it('shows the edit pencil on idea cards but not on plain highlights', () => {
    renderPanel()
    const ideaCard = screen.getByText('我的想法丙').closest('.group')!
    expect(ideaCard.querySelector('[title="annotation.editNote"]')).not.toBeNull()
    const highlightCard = screen.getByText('直线划线甲').closest('.group')!
    expect(highlightCard.querySelector('[title="annotation.editNote"]')).toBeNull()
  })

  it('shows expand toggle for long highlights and toggles expand state', () => {
    const longText = '这是一段超过六十五个字符的长文本划线，在阅读器侧栏中需要支持就地展开查看全文，而不是只能点击跳转。'.repeat(2)
    const longItem = makeAnnotation({ id: 'long-1', cfiRange: 'cfi:long', text: longText })
    render(<NotesPanel items={[longItem]} total={1} sort="chapter" chapterOrder={[]} bookId="book-1" />)
    const expandBtn = screen.getByText('annotation.expand')
    expect(expandBtn).toBeInTheDocument()
    fireEvent.click(expandBtn)
    expect(screen.getByText('annotation.collapse')).toBeInTheDocument()
  })

  it('expands all items when allExpanded is true', () => {
    const longText = '这是一段超过六十五个字符的长文本划线，在阅读器侧栏中需要支持就地展开查看全文，而不是只能点击跳转。'.repeat(2)
    const longItem = makeAnnotation({
      id: 'long-2',
      cfiRange: 'cfi:long-2',
      text: longText,
    })
    render(<NotesPanel items={[longItem]} total={1} sort="chapter" chapterOrder={[]} bookId="book-1" allExpanded={true} />)
    expect(screen.getByText('annotation.collapse')).toBeInTheDocument()
  })

  it('arranges card action buttons in order: edit, copy, share, delete', () => {
    renderPanel()
    const ideaCard = screen.getByText('我的想法丙').closest('.group')!
    const actionButtons = Array.from(ideaCard.querySelectorAll('button[title]')).map((btn) => btn.getAttribute('title'))
    // Exclude the card-level click button if it has title
    const footerButtons = actionButtons.filter((title) =>
      ['annotation.editNote', 'annotation.copy', 'annotation.share', 'annotation.deleteHighlight'].includes(title ?? ''),
    )
    expect(footerButtons).toEqual([
      'annotation.editNote',
      'annotation.copy',
      'annotation.share',
      'annotation.deleteHighlight',
    ])
  })

  it('highlights selected cards in selectionMode', () => {
    const item = makeAnnotation({ id: 'sel-1', cfiRange: 'cfi:sel', text: '选择测试' })
    render(
      <NotesPanel
        items={[item]}
        total={1}
        sort="chapter"
        chapterOrder={[]}
        bookId="book-1"
        selectionMode={true}
        selectedIds={new Set(['sel-1'])}
      />,
    )
    const card = screen.getByText('选择测试').closest('.group')!
    expect(card.className).toContain('border-[var(--bd-read-primary)]/50')
  })

  it('renders hover-swappable relative and exact datetime in footer', () => {
    const item = makeAnnotation({ id: 'time-1', cfiRange: 'cfi:t1', text: '时间测试', createdAt: 1726200000000 })
    render(
      <NotesPanel
        items={[item]}
        total={1}
        sort="chapter"
        chapterOrder={[]}
        bookId="book-1"
      />,
    )
    const timeContainer = screen.getByLabelText(/annotation\.timeFull|2026/)
    expect(timeContainer).toBeInTheDocument()
    // Contains relative time element and full datetime element
    expect(timeContainer.querySelector('.group-hover\\/time\\:hidden')).toBeInTheDocument()
    expect(timeContainer.querySelector('.group-hover\\/time\\:inline')).toBeInTheDocument()
  })
})
