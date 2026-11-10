import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MOCKS = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getBook: vi.fn(),
  openLocalReaderSession: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'book-b' }),
}))

vi.mock('@/api/client', () => ({
  apiGet: (...args: unknown[]) => MOCKS.apiGet(...args),
}))

vi.mock('@/features/local-library/repository', () => ({
  localLibraryRepository: {
    getBook: (...args: unknown[]) => MOCKS.getBook(...args),
  },
}))

vi.mock('@/features/local-library/reader-session', () => ({
  openLocalReaderSession: (...args: unknown[]) => MOCKS.openLocalReaderSession(...args),
}))

vi.mock('@/features/reader/Reader', () => ({
  default: () => <div data-testid="mock-remote-reader" />,
}))

vi.mock('@/features/local-library/LocalReaderRoute', () => ({
  default: () => <div data-testid="mock-local-reader" />,
}))

import { BookReaderDispatch } from './BookSourceDispatch'
import { warmReaderEntry } from './reader-entry-prefetch'
import { LOCAL_VAULT_ID } from '../local-library/id'

describe('warmReaderEntry & BookSourceDispatch', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    MOCKS.apiGet.mockReset().mockResolvedValue({ data: [] })
    MOCKS.getBook.mockReset().mockImplementation(() => new Promise(() => {}))
    MOCKS.openLocalReaderSession.mockReset().mockResolvedValue({ namespace: 'local-ns' })
  })

  afterEach(() => {
    client.clear()
  })

  it('seeds book-source-resolve and prefetches remote book + chapters when clicked', async () => {
    warmReaderEntry(client, { bookId: 'book-b', isLocal: false })

    expect(client.getQueryData(['book-source-resolve', 'book-b'])).toBe(false)
    await waitFor(() => {
      expect(MOCKS.apiGet).toHaveBeenCalledWith('/books/book-b')
      expect(MOCKS.apiGet).toHaveBeenCalledWith('/books/book-b/chapters')
    })
    expect(MOCKS.openLocalReaderSession).not.toHaveBeenCalled()
  })

  it('seeds book-source-resolve and prefetches local session for device books', async () => {
    warmReaderEntry(client, { bookId: 'book-b', isLocal: true })

    expect(client.getQueryData(['book-source-resolve', 'book-b'])).toBe(true)
    await waitFor(() => {
      expect(MOCKS.openLocalReaderSession).toHaveBeenCalledWith({
        scope: { kind: 'local', vaultId: LOCAL_VAULT_ID },
        bookId: 'book-b',
      })
    })
    expect(MOCKS.apiGet).not.toHaveBeenCalled()
  })

  it('supports hover pre-seeding without triggering data fetches prematurely', () => {
    warmReaderEntry(client, { bookId: 'book-b', isLocal: false, prefetch: false })

    expect(client.getQueryData(['book-source-resolve', 'book-b'])).toBe(false)
    expect(MOCKS.apiGet).not.toHaveBeenCalled()
    expect(MOCKS.openLocalReaderSession).not.toHaveBeenCalled()
  })

  it('skips the full-screen BookSourceDispatch pending state when source resolution was seeded', async () => {
    // Simulate having already warmed the lazy chunk (e.g. pointer hover or prior book open)
    await import('@/features/reader/Reader')
    warmReaderEntry(client, { bookId: 'book-b', isLocal: false, prefetch: false })

    render(
      <QueryClientProvider client={client}>
        <BookReaderDispatch />
      </QueryClientProvider>,
    )

    // Even while localLibraryRepository.getBook never settles, BookSourceDispatch
    // does not block behind ReaderPending when the route chunk + source are seeded.
    await waitFor(() => {
      expect(screen.getByTestId('mock-remote-reader')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
