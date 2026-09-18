import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { BookListItem } from '@bookdock/shared'

import TrashInfo from '../features/library/components/TrashInfo'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(async () => ({ data: {} })),
}))

const DAY_MS = 24 * 60 * 60 * 1000

const baseBook = {
  id: 'book-1',
  title: 'Trashed Book',
  format: 'epub',
  size: 1024,
  createdAt: 0,
  updatedAt: 0,
  shelfId: null,
  deletedAt: Date.now() - 5 * DAY_MS,
} as unknown as BookListItem

function renderInfo(book: BookListItem, autoCleanDays: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings'], { data: { trash: { autoCleanDays } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrashInfo book={book} />
    </QueryClientProvider>,
  )
}

describe('TrashInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the purge countdown inline with deleted days as tooltip', () => {
    const { container } = renderInfo(baseBook, 30)
    expect(screen.getByText('library.trashPurgeInDays:25')).toBeInTheDocument()
    expect(container.querySelector('p')!.title).toBe('library.trashDeletedDays:5')
  })

  it('shows only deleted days when auto-clean is disabled', () => {
    renderInfo(baseBook, 0)
    expect(screen.getByText('library.trashDeletedDays:5')).toBeInTheDocument()
    expect(screen.queryByText(/trashPurgeInDays/)).not.toBeInTheDocument()
  })

  it('warns in red when purge is within 3 days', () => {
    const { container } = renderInfo(
      { ...baseBook, deletedAt: Date.now() - 28 * DAY_MS } as BookListItem,
      30,
    )
    const p = container.querySelector('p')!
    expect(p.className).toContain('text-red-500')
    expect(screen.getByText('library.trashPurgeInDays:2')).toBeInTheDocument()
  })

  it('shows cleanup pending once retention has elapsed', () => {
    const { container } = renderInfo(
      { ...baseBook, deletedAt: Date.now() - 30 * DAY_MS } as BookListItem,
      30,
    )
    const p = container.querySelector('p')!
    expect(p.className).toContain('text-red-500')
    expect(screen.getByText('library.trashPurgeSoon')).toBeInTheDocument()
  })

  it('renders nothing without deletedAt', () => {
    const { container } = renderInfo({ ...baseBook, deletedAt: null } as BookListItem, 30)
    expect(container).toBeEmptyDOMElement()
  })
})
