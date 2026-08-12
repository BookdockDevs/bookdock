import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import { useUiStore } from '@/stores/ui.store'
import { ListItemWrapper } from '../features/library/Library'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}))

vi.mock('@/routes/index', () => ({ indexRoute: { id: '/' } }))

const book: BookListItem = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Author',
  format: 'epub',
  coverKey: null,
  size: 1024,
  readStatus: 'reading',
  progress: 59,
  createdAt: new Date(2026, 0, 2).getTime(),
  updatedAt: new Date(2026, 0, 3).getTime(),
  lastReadAt: Date.now() - 2 * 3600_000,
  shelfName: 'Favorites',
  tags: ['小说', '科幻'],
}

function renderRow() {
  return render(
    <ListItemWrapper
      book={book}
      selection={new Set()}
      selectionActive={false}
      onToggleSelect={vi.fn()}
      onDelete={vi.fn()}
      onShowDetails={vi.fn()}
    />,
  )
}

beforeEach(async () => {
  localStorage.clear()
  useUiStore.setState({ listInfoItems: ['progress'] })
  await i18n.changeLanguage('zh-CN')
})

describe('Library list row', () => {
  it('renders title and format badge without the read-status dot', () => {
    const { container } = renderRow()

    expect(screen.getByText('Test Book')).toBeInTheDocument()
    expect(screen.getByText('epub')).toBeInTheDocument()
    expect(container.querySelector('.bg-blue-500')).toBeNull()
  })

  it('shows the progress text by default', () => {
    renderRow()

    expect(screen.getByText('进度 59%')).toBeInTheDocument()
    expect(screen.queryByText('1 KB')).toBeNull()
  })

  it('renders the enabled optional items and skips the disabled ones', () => {
    useUiStore.setState({ listInfoItems: ['size', 'shelf', 'tags', 'createdAt'] })
    renderRow()

    expect(screen.getByText('1 KB')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('小说、科幻')).toBeInTheDocument()
    expect(screen.getByText('2026-01-02')).toBeInTheDocument()
    expect(screen.queryByText('进度 59%')).toBeNull()
  })

  it('renders no info area when every item is off', () => {
    useUiStore.setState({ listInfoItems: [] })
    const { container } = renderRow()

    expect(container.querySelector('.md\\:flex')).toBeNull()
    expect(screen.queryByText('进度 59%')).toBeNull()
  })
})
