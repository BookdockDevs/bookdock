import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import type { AnnotationRes } from '@bookdock/shared'

import { IdeaOverlay, type IdeaEntry } from '../features/reader/components/IdeaOverlay'

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
    <IdeaOverlay
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

  it('hides the expand chevron when the quote fits within three lines', () => {
    mockQuoteOverflow(false)
    renderOverlay()
    expect(screen.queryByTitle('annotation.expandQuote')).toBeNull()
  })

  it('expands and collapses an overflowing quote via the chevron', () => {
    mockQuoteOverflow(true)
    renderOverlay()
    const quote = screen.getByText('quote text')
    expect(quote.className).toContain('line-clamp-4')

    const toggle = screen.getByTitle('annotation.expandQuote')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(quote.className).not.toContain('line-clamp-4')
    const collapse = screen.getByTitle('annotation.collapseQuote')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)

    expect(quote.className).toContain('line-clamp-4')
    expect(screen.getByTitle('annotation.expandQuote')).toBeInTheDocument()
  })

  it('switches to the detail level when an entry card is clicked', () => {
    renderOverlay()
    fireEvent.click(screen.getByText('a thought'))
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

    const titles = screen.getAllByRole('button').map((button) => button.getAttribute('title'))
    expect(titles.slice(0, 6)).toEqual([
      'annotation.copy',
      'annotation.drawHighlight',
      'annotation.writeNote',
      'reader.aiChatSelection',
      'reader.search',
      'annotation.shareExcerpt',
    ])
  })
})
