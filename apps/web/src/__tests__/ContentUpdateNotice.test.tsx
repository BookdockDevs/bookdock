import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { BookDetailRes } from '@bookdock/shared'

import { apiPut } from '../api/client'
import { notify } from '../lib/notifications'
import ContentUpdateNotice from '../features/reader/components/ContentUpdateNotice'

vi.mock('../api/client', () => ({ apiPut: vi.fn() }))
vi.mock('../lib/notifications', () => ({ notify: { info: vi.fn() } }))

const book = (over: Partial<BookDetailRes> = {}) => ({ id: 'b1', revisionId: 'r1', hasUnreadUpdate: true, ...over }) as BookDetailRes
const client = () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })

function show(data: BookDetailRes | undefined, ready = false, guest = false, queryClient = client()) {
  const view = (next: BookDetailRes | undefined, loaded = ready) => (
    <QueryClientProvider client={queryClient}>
      <ContentUpdateNotice bookId={next?.id ?? 'b1'} book={next} ready={loaded} guest={guest} />
    </QueryClientProvider>
  )
  return { ...render(view(data)), view, queryClient }
}

describe('ContentUpdateNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiPut).mockResolvedValue({ data: {} })
  })

  it('shows the fresh reader response and waits for rendering to acknowledge', async () => {
    const result = show(book())
    expect(notify.info).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
    result.rerender(result.view(book(), true))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/books/b1/read-revision', { revisionId: 'r1' }))
    expect(notify.info).toHaveBeenCalledExactlyOnceWith({ key: 'reader.contentUpdated' })
  })

  it('acknowledges opening without a position write and clears both matching caches', async () => {
    const queryClient = client()
    queryClient.setQueryData(['books', 'detail', 'b1'], { data: book() })
    queryClient.setQueryData(['book', 'b1'], { data: book() })
    const result = show(book(), true, false, queryClient)
    await waitFor(() => expect(queryClient.getQueryData<{ data: BookDetailRes }>(['books', 'detail', 'b1'])?.data.hasUnreadUpdate).toBe(false))
    expect(queryClient.getQueryData<{ data: BookDetailRes }>(['book', 'b1'])?.data.hasUnreadUpdate).toBe(false)
    result.rerender(result.view(book({ hasUnreadUpdate: false }), true))
    expect(notify.info).toHaveBeenCalledTimes(1)
    expect(apiPut).toHaveBeenCalledTimes(1)
  })

  it('does not clear a newer revision while an old acknowledgment completes', async () => {
    const queryClient = client()
    queryClient.setQueryData(['book', 'b1'], { data: book({ revisionId: 'r2' }) })
    show(book(), true, false, queryClient)
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1))
    expect(queryClient.getQueryData<{ data: BookDetailRes }>(['book', 'b1'])?.data.hasUnreadUpdate).toBe(true)
  })

  it('waits for fresh detail instead of latching an absent answer', async () => {
    const result = show(undefined)
    expect(result.container).toBeEmptyDOMElement()
    expect(notify.info).not.toHaveBeenCalled()
    result.rerender(result.view(book(), true))
    await waitFor(() => expect(notify.info).toHaveBeenCalledExactlyOnceWith({ key: 'reader.contentUpdated' }))
  })

  it('re-evaluates when a different book opens', async () => {
    const result = show(book({ hasUnreadUpdate: false }))
    expect(result.container).toBeEmptyDOMElement()
    result.rerender(result.view(book({ id: 'b2' }), true))
    await waitFor(() => expect(notify.info).toHaveBeenCalledTimes(1))
  })

  it('never acknowledges guest reads', async () => {
    show(book({ hasUnreadUpdate: false }), true, true)
    expect(apiPut).not.toHaveBeenCalled()
    expect(notify.info).not.toHaveBeenCalled()
  })
})
