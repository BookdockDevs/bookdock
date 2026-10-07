import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import type { AnnotationRes } from '@bookdock/shared'

import { IdeaOverlay, type IdeaEntry } from '../features/reader/components/IdeaOverlay'
import { useUiStore } from '../stores/ui.store'

function makeAnnotation(overrides?: Partial<AnnotationRes>): AnnotationRes {
  return {
    id: 'ann1',
    bookId: 'book1',
    cfiRange: 'epubcfi(/6/2!/4/2/1:0,/4/2/1:10)',
    cfiAnchor: null,
    type: 'note',
    color: 'yellow',
    style: 'highlight',
    text: 'quote text',
    note: 'a thought',
    chapter: null,
    createdAt: 1720000000000,
    updatedAt: 1720000000000,
    ...overrides,
  }
}

function renderOverlay(props?: Partial<Parameters<typeof IdeaOverlay>[0]>) {
  const entry: IdeaEntry = { annotation: makeAnnotation(), own: true }
  return render(
    <IdeaOverlay bookId="book1"
      entries={[entry]}
      quoteText="quote text"
      onCopyQuote={vi.fn()}
      onHighlight={vi.fn()}
      onWriteNote={vi.fn()}
      onAiChat={vi.fn()}
      onShareQuote={vi.fn()}
      onSearch={vi.fn()}
      onCopyNote={vi.fn()}
      onShareNote={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

function mockQuoteOverflow(overflows: boolean) {
  // jsdom reports 0 for both heights; stub them so the overflow check is testable
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => (overflows ? 200 : 50) })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 50 })
}

describe('IdeaOverlay', () => {
  beforeEach(() => {
    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  })

  it('uses the entry avatar key when present', () => {
    renderOverlay({
      entries: [{ annotation: makeAnnotation(), own: true, authorAvatarKey: 'ab/abc123.png' }],
    })

    expect(document.querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/ab/abc123.png')
  })

  it('refreshes the selected idea avatar and actions when entries change', () => {
    const entry: IdeaEntry = { annotation: makeAnnotation(), authorAvatarKey: 'ab/old.gif', own: true }
    const onShareNote = vi.fn()
    const props = {
      entries: [entry], onCopyQuote: vi.fn(), onHighlight: vi.fn(), onWriteNote: vi.fn(), onAiChat: vi.fn(),
      onShareQuote: vi.fn(), onSearch: vi.fn(), onCopyNote: vi.fn(), onShareNote, onEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(),
    }
    const { rerender } = render(<IdeaOverlay bookId="book1" {...props} />)
    fireEvent.click(screen.getByLabelText('annotation.openIdeaDetail'))
    const updated = { ...entry, authorAvatarKey: 'cd/new.gif' }
    rerender(<IdeaOverlay bookId="book1" {...props} entries={[updated]} />)
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/cd/new.gif')
    fireEvent.click(screen.getByTitle('annotation.share'))
    expect(onShareNote).toHaveBeenCalledWith(updated)
    rerender(<IdeaOverlay bookId="book1" {...props} entries={[{ ...updated, authorAvatarKey: null }]} />)
    expect(document.querySelector('img')).toBeNull()
  })

  it('hides the expand chevron when the quote fits within three lines', () => {
    mockQuoteOverflow(false)
    renderOverlay()
    expect(screen.queryByTitle('annotation.expandQuote')).toBeNull()
  })

  it('expands and collapses an overflowing quote via the chevron', () => {
    mockQuoteOverflow(true)
    renderOverlay()
    const quote = screen.getByText('quote text')
    expect(quote.className).toContain('line-clamp-')

    const toggle = screen.getByTitle('annotation.expandQuote')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(quote.className).not.toContain('line-clamp-')
    const collapse = screen.getByTitle('annotation.collapseQuote')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)

    expect(quote.className).toContain('line-clamp-')
    expect(screen.getByTitle('annotation.expandQuote')).toBeInTheDocument()
  })

  it('switches to the detail level when an entry card is clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByLabelText('annotation.openIdeaDetail'))
    expect(screen.getByText(/annotation\.publishedAt/)).toBeInTheDocument()
  })

  it('invokes AI chat from the quote actions', () => {
    const onAiChat = vi.fn()
    renderOverlay({ onAiChat })

    fireEvent.click(screen.getByTitle('reader.aiChatSelection'))

    expect(onAiChat).toHaveBeenCalledTimes(1)
  })

  it('uses the reader font for the quote', () => {
    renderOverlay({ fontStack: '"Reader Font", serif', fontCss: '@font-face { font-family: "Reader Font"; }' })

    const quote = screen.getByText('quote text')
    expect(quote).toHaveStyle({ fontFamily: '"Reader Font", serif' })
    expect(document.querySelector('style[data-reader-font]')).toHaveTextContent('@font-face')
  })

  it('keeps quote actions in the same order as the selection menu', () => {
    renderOverlay()

    const titles = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'))
      .filter((title) => title !== 'annotation.cancel')
    expect(titles.slice(0, 6)).toEqual([
      'annotation.copy',
      'annotation.drawHighlight',
      'annotation.writeNote',
      'reader.aiChatSelection',
      'reader.search',
      'annotation.shareExcerpt',
    ])
  })

  it('jumps to source text when the detail quote block is clicked', () => {
    const onJump = vi.fn()
    renderOverlay({ onJump, initialDetailId: 'ann1' })
    const quoteBlock = screen.getByRole('button', { name: 'annotation.jumpToSource' })
    fireEvent.click(quoteBlock)
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('triggers like toggle directly from the idea card action button', () => {
    const onToggleLike = vi.fn()
    renderOverlay({ onToggleLike })
    const likeBtn = screen.getByTitle('comment.like')
    fireEvent.click(likeBtn)
    expect(onToggleLike).toHaveBeenCalledTimes(1)
  })

  it('supports in-situ idea creation in sidebar mode', async () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    const onSaveIdea = vi.fn().mockResolvedValue(undefined)
    renderOverlay({ onSaveIdea })

    const trigger = screen.getByText('annotation.writeNote')
    act(() => {
      fireEvent.click(trigger)
    })

    const textarea = screen.getByLabelText('annotation.notePlaceholder')
    act(() => {
      fireEvent.change(textarea, { target: { value: 'My inline thought' } })
    })

    const publishBtn = screen.getByText('annotation.publish')
    await act(async () => {
      fireEvent.click(publishBtn)
    })

    expect(onSaveIdea).toHaveBeenCalledWith('My inline thought', 'private')
    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  it('renders resize handle and supports double-click reset in sidebar mode', () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    renderOverlay()

    const handle = screen.getByTestId('idea-sidebar-resize-handle')
    expect(handle).toBeInTheDocument()
    fireEvent.doubleClick(handle)
    expect(useUiStore.getState().ideaSidebarWidth).toBe(380)

    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  it('toggles idea more actions menu when clicking more icon', () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    const onShare = vi.fn()
    renderOverlay({ onShareNote: onShare })

    const moreBtn = screen.getByRole('button', { name: 'reader.more' })
    fireEvent.click(moreBtn)
    expect(screen.getByText('annotation.share')).toBeInTheDocument()

    // Clicking more icon again closes the menu
    fireEvent.click(moreBtn)
    expect(screen.queryByText('annotation.share')).toBeNull()

    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  it('expands discussion inline below the entry card in sidebar mode', () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    renderOverlay()
    const openBtn = screen.getByLabelText('annotation.openIdeaDetail')
    fireEvent.click(openBtn)
    expect(screen.getByLabelText('annotation.collapse')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('annotation.collapse'))
    expect(screen.getByLabelText('annotation.openIdeaDetail')).toBeInTheDocument()
    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  it('supports closing via header collapse button in sidebar mode', () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    const onClose = vi.fn()
    renderOverlay({ onClose })

    const collapseBtn = screen.getByTitle('annotation.cancel')
    expect(collapseBtn).toBeInTheDocument()
    fireEvent.click(collapseBtn)
    expect(onClose).toHaveBeenCalledTimes(1)

    useUiStore.getState().setIdeaDisplayMode('modal')
  })

  it('handles stepped Escape key in sidebar mode', () => {
    useUiStore.getState().setIdeaDisplayMode('sidebar')
    const onClose = vi.fn()
    renderOverlay({ onClose })

    // Step 1: Open inline discussion
    const openBtn = screen.getByLabelText('annotation.openIdeaDetail')
    fireEvent.click(openBtn)
    expect(screen.getByLabelText('annotation.collapse')).toBeInTheDocument()

    // Escape collapses discussion first, does not call onClose
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByLabelText('annotation.openIdeaDetail')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Step 2: Next Escape closes sidebar
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    useUiStore.getState().setIdeaDisplayMode('modal')
  })
})

vi.mock('../features/reader/hooks/useIdeas', () => ({
  useIdeaComposer: () => ({ data: { data: { eligible: false, sourceReadable: false, defaultVisibility: 'private', revisionId: null } } }),
  useReaderIdeas: () => ({ data: { data: [] }, isError: false }),
  useIdeaDiscussion: () => ({ isPending: true }),
  useIdeaAction: () => ({ isPending: false }),
}))