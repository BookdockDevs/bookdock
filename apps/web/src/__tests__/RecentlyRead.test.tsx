import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import RecentlyRead from '../features/library/components/RecentlyRead'
import { useBooks } from '../features/library/hooks'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

vi.mock('../features/library/hooks', () => ({
  useBooks: vi.fn(),
}))

// jsdom lacks ResizeObserver (used by the scroll-state effect)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function makeBook(overrides: Partial<BookListItem>): BookListItem {
  return {
    id: 'book-1',
    title: 'Book One',
    author: 'Author',
    format: 'epub',
    coverKey: null,
    size: 1024,
    readStatus: 'reading',
    progress: 22,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: Date.now() - 2 * 3600_000,
    ...overrides,
  } as BookListItem
}

const books = [
  makeBook({ id: 'book-1', title: 'Book One', progress: 22 }),
  makeBook({ id: 'book-2', title: 'Book Two', progress: 0, lastReadAt: Date.now() - 3 * 24 * 3600_000 }),
]

function mockScrollable(scrollable: boolean) {
  // jsdom reports 0 for all scroll metrics; stub them so arrow visibility is testable
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => (scrollable ? 1000 : 200) })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 })
}

beforeEach(async () => {
  localStorage.clear()
  vi.mocked(useBooks).mockReturnValue({ data: { data: books, total: 2, page: 1, pageSize: 30 }, isLoading: false } as ReturnType<typeof useBooks>)
  await i18n.changeLanguage('zh-CN')
})

afterEach(() => {
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})

describe('RecentlyRead covers style', () => {
  it('renders titles and progress percent, hiding the percent at 0%', () => {
    render(<RecentlyRead style="covers" />)

    expect(screen.getByRole('heading', { name: 'Book One' })).toBeInTheDocument()
    expect(screen.getByText('22%')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Book Two' })).toBeInTheDocument()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('shows the right fade mask only when scrollable', () => {
    mockScrollable(false)
    const { container, unmount } = render(<RecentlyRead style="covers" />)
    expect(container.querySelector('.bg-gradient-to-l')).toBeNull()
    unmount()

    mockScrollable(true)
    const { container: container2 } = render(<RecentlyRead style="covers" />)
    expect(container2.querySelector('.bg-gradient-to-l')).not.toBeNull()
  })
})

describe('RecentlyRead cards style', () => {
  it('renders relative read time instead of a progress bar', () => {
    const { container } = render(<RecentlyRead style="cards" />)

    expect(screen.getByText('Book One')).toBeInTheDocument()
    expect(screen.getByText('2 小时前')).toBeInTheDocument()
    expect(screen.getByText('3 天前')).toBeInTheDocument()
    expect(container.querySelector('.h-1')).toBeNull()
    expect(screen.queryByText('22%')).toBeNull()
  })

  it('hides the arrow buttons when the row does not overflow', () => {
    mockScrollable(false)
    render(<RecentlyRead style="cards" />)

    expect(screen.queryByRole('button', { name: '向左滚动' })).toBeNull()
    expect(screen.queryByRole('button', { name: '向右滚动' })).toBeNull()
  })

  it('shows the right arrow when the row overflows', () => {
    mockScrollable(true)
    render(<RecentlyRead style="cards" />)

    expect(screen.getByRole('button', { name: '向右滚动' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '向左滚动' })).toBeNull()
  })
})
