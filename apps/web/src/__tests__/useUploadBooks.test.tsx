import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToastStore } from '@/stores/toast.store'

import { useUploadBooks } from '../features/library/hooks'

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

class FakeXHR {
  static instances: FakeXHR[] = []
  status = 200
  responseText = '{}'
  aborted = false
  upload = { addEventListener: vi.fn() }
  /** What the queue actually asked the server for. */
  method = ''
  url = ''
  fields: Record<string, string> = {}
  files: File[] = []
  private listeners = new Map<string, (() => void)[]>()

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: FormData) {
    this.fields = Object.fromEntries(Array.from(body.entries())
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)]))
    this.files = Array.from(body.entries())
      .filter(([, v]) => v instanceof File)
      .map(([, v]) => v as File)
    FakeXHR.instances.push(this)
  }
  addEventListener(type: string, cb: () => void) {
    const list = this.listeners.get(type) ?? []
    list.push(cb)
    this.listeners.set(type, list)
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.fire('load')
    this.fire('loadend')
  }
  abort() {
    this.aborted = true
    this.fire('abort')
    this.fire('loadend')
  }
  private fire(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb()
  }
}

describe('useUploadBooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    useToastStore.getState().clearToasts()
    queryClient.setQueryData(['books'], { data: [] })
    FakeXHR.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not settle or notify while picker-selected files are pending', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File([], 'book.epub')])
    })

    expect(result.current.items[0]?.status).toBe('pending')
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(queryClient.getQueryState(['books'])?.isInvalidated).not.toBe(true)
  })

  it('rejects oversized files before queueing them', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['12345'], 'big.epub'), new File(['1'], 'ok.epub')], { maxBytes: 3 })
    })

    expect(result.current.items.map((it) => it.name)).toEqual(['ok.epub'])
    expect(
      useToastStore
        .getState()
        .toasts.some((t) => typeof t.message === 'object' && t.message.key === 'library.uploadOversized'),
    ).toBe(true)
  })

  it('maps server error codes to i18n keys instead of raw messages', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'big.epub')], { autoStart: true })
    })
    const xhr = FakeXHR.instances[0]!
    act(() => {
      xhr.respond(413, { error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } })
    })

    const item = result.current.items[0]!
    expect(item.status).toBe('error')
    expect(item.messageKey).toBe('errors.uploadTooLarge')
  })

  it('reports the number of newly imported books', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'book-1' }, duplicated: false })
    })

    const toast = useToastStore.getState().toasts[0]
    expect(toast?.type).toBe('success')
    expect(toast?.message).toEqual({ key: 'library.uploadImported', params: { count: 1 } })
  })

  it('reports duplicate-only uploads as a warning', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'book-1' }, duplicated: true })
    })

    const toast = useToastStore.getState().toasts[0]
    expect(toast?.type).toBe('warning')
    expect(toast?.message).toEqual({ key: 'library.uploadDuplicateOnly', params: { count: 1 } })
  })

  it('re-queues an errored item on retry', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })
    })
    expect(result.current.items[0]!.status).toBe('error')

    act(() => {
      result.current.retry(result.current.items[0]!.id)
    })
    expect(result.current.items[0]!.status).toBe('uploading')
    expect(result.current.items[0]!.messageKey).toBeUndefined()
  })

  /**
   * One queue, two destinations. A shared library's catalog upload runs through
   * this same machine, so the endpoint, the form fields and the refreshed query
   * keys all have to come from the target - if they do not, a catalog upload
   * would silently post to the reader's own library.
   */
  it('sends files to a shared library catalog with the target\'s fields and refreshes the library\'s own lists', () => {
    queryClient.setQueryData(['libraries', 'lib-1', 'catalog'], { data: { items: [], total: 0 } })
    queryClient.setQueryData(['libraries', 'lib-1', 'categories'], { data: [] })
    const target = {
      url: '/libraries/lib-1/books',
      fields: () => ({ libraryBookId: 'lb-9', categoryId: 'cat-3' }),
      invalidateKeys: [['libraries', 'lib-1', 'catalog'], ['libraries', 'lib-1', 'categories']],
    }
    const { result } = renderHook(() => useUploadBooks(target), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'lb-10' }, duplicated: false })
    })

    const sent = FakeXHR.instances[0]!
    expect(sent.method).toBe('POST')
    expect(sent.url).toMatch(/\/libraries\/lib-1\/books$/)
    expect(sent.fields).toEqual({ libraryBookId: 'lb-9', categoryId: 'cat-3' })
    expect(sent.files.map((f) => f.name)).toEqual(['book.epub'])
    // The private lists are not the reader's concern here, and the catalog is.
    expect(queryClient.getQueryState(['books'])?.isInvalidated).not.toBe(true)
    expect(queryClient.getQueryState(['libraries', 'lib-1', 'catalog'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['libraries', 'lib-1', 'categories'])?.isInvalidated).toBe(true)
  })

  it('still posts to the private library by default', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true, shelfId: 'shelf-1', tagIds: ['tag-1'] })
    })

    const sent = FakeXHR.instances[0]!
    expect(sent.url).toMatch(/\/books$/)
    expect(sent.fields).toEqual({ shelfId: 'shelf-1', tagIds: '["tag-1"]' })
    expect(sent.files.map((f) => f.name)).toEqual(['book.epub'])
  })

  it('prunes settled rows but keeps in-flight uploads', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub'), new File(['b'], 'b.epub')])
    })
    act(() => {
      result.current.startUpload()
    })
    expect(FakeXHR.instances).toHaveLength(2)
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'book-1' }, duplicated: false })
    })
    expect(result.current.items.map((it) => it.status)).toEqual(['success', 'uploading'])

    act(() => {
      result.current.pruneSettled()
    })
    expect(result.current.items.map((it) => it.name)).toEqual(['b.epub'])
  })

  it('flags a duplicate whose requested shelf was not applied', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true, shelfId: 'shelf-b' })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'book-1', shelfId: 'shelf-a' }, duplicated: true })
    })

    const item = result.current.items[0]!
    expect(item.status).toBe('duplicate')
    expect(item.messageKey).toBe('library.uploadDuplicateNotMoved')
  })

  it('shows a plain duplicate label when the shelf already matches', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true, shelfId: 'shelf-a' })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'book-1', shelfId: 'shelf-a' }, duplicated: true })
    })

    const item = result.current.items[0]!
    expect(item.status).toBe('duplicate')
    expect(item.messageKey).toBeUndefined()
  })

  it('remembers the uploaded book id so the sheet can offer reading it', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { id: 'bv-1' }, duplicated: false })
    })

    expect(result.current.items[0]!.bookVersionId).toBe('bv-1')
  })

  it('reads a duplicate the same way, and takes the id from a catalog work', () => {
    const target = {
      url: '/libraries/lib-1/books',
      invalidateKeys: [['libraries', 'lib-1', 'catalog']],
      pickBookId: (body: unknown) =>
        (body as { data?: { versions?: { bookVersionId?: string }[] } } | null)?.data?.versions?.[0]?.bookVersionId,
    }
    const { result } = renderHook(() => useUploadBooks(target), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['x'], 'book.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances[0]!.respond(201, { data: { versions: [{ bookVersionId: 'bv-9' }] }, duplicated: true })
    })

    const item = result.current.items[0]!
    expect(item.status).toBe('duplicate')
    expect(item.bookVersionId).toBe('bv-9')
  })

  it('stages every pick as one batch while nothing is running', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub')])
    })
    // Nothing is running, so the reader still gets to confirm the pick.
    expect(result.current.items.map((i) => i.status)).toEqual(['pending'])
    expect(FakeXHR.instances).toHaveLength(0)

    act(() => {
      result.current.addFiles([new File(['b'], 'b.epub')])
    })
    // A second pick joins the same batch rather than firing anything off early.
    expect(result.current.items.map((i) => i.status)).toEqual(['pending', 'pending'])
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('queues a pick made once the batch is already running', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub')], { autoStart: true })
    })
    expect(FakeXHR.instances).toHaveLength(1)

    act(() => {
      result.current.addFiles([new File(['b'], 'b.epub')])
    })
    // The batch is open, so the pick joins it instead of staging again.
    expect(result.current.items.map((i) => i.status)).toEqual(['uploading', 'uploading'])
    expect(FakeXHR.instances).toHaveLength(2)
  })

  it('releases staged files when an auto-starting one joins them', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub')])
    })
    expect(result.current.items[0]!.status).toBe('pending')

    act(() => {
      result.current.addFiles([new File(['b'], 'b.epub')], { autoStart: true })
    })
    // A drop means "upload these too", so it must not leave the staged one behind
    // waiting for a second click - the scheduler has both requests open.
    expect(result.current.items.every((i) => i.status === 'uploading')).toBe(true)
    expect(FakeXHR.instances).toHaveLength(2)
  })

  it('cancels in-flight requests and parks the ones the pool never started', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    // Five files against a pool of three: three requests open, two still queued.
    act(() => {
      result.current.addFiles(
        ['a', 'b', 'c', 'd', 'e'].map((n) => new File(['x'], `${n}.epub`)),
        { autoStart: true },
      )
    })
    expect(FakeXHR.instances).toHaveLength(3)
    expect(result.current.items.filter((i) => i.status === 'queued')).toHaveLength(2)

    act(() => {
      result.current.abortAll()
    })

    // The three open requests are really aborted...
    expect(FakeXHR.instances.every((x) => x.aborted)).toBe(true)
    // ...and nothing is left queued, or the scheduler would roll straight into
    // the next file and the cancel would have achieved nothing.
    expect(result.current.items).toHaveLength(5)
    expect(result.current.items.every((i) => i.status === 'error')).toBe(true)
    expect(result.current.items.every((i) => i.messageKey === 'library.uploadCancelled')).toBe(true)
    expect(result.current.isUploading).toBe(false)
    expect(FakeXHR.instances).toHaveLength(3)
  })

  it('does not summarise a cancelled batch as a failure', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub')], { autoStart: true })
    })
    act(() => {
      result.current.abortAll()
    })

    expect(result.current.items[0]!.status).toBe('error')
    // The reader stopped it; a red "1 failed" toast would blame them for it.
    expect(useToastStore.getState().toasts).toHaveLength(0)
    // The list behind the sheet still refreshes, in case one file had landed.
    expect(queryClient.getQueryState(['books'])?.isInvalidated).toBe(true)
  })

  it('summarises normally again once a new batch starts after a cancel', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub')], { autoStart: true })
    })
    act(() => {
      result.current.abortAll()
    })
    useToastStore.getState().clearToasts()

    act(() => {
      result.current.addFiles([new File(['b'], 'b.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances.at(-1)!.respond(201, { data: { id: 'bv-2' }, duplicated: false })
    })

    // The suppression lifted: a new batch reports again. The summary is a
    // composed string, and it counts the cancelled row next to the new result
    // rather than quietly dropping it.
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(typeof toasts[0]!.message).toBe('string')
  })

  it('retries every failed row at once', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File(['a'], 'a.epub'), new File(['b'], 'b.epub')], { autoStart: true })
    })
    act(() => {
      FakeXHR.instances.forEach((x) => x.respond(500, { error: { code: 'UPLOAD_FAILED' } }))
    })
    expect(result.current.items.every((i) => i.status === 'error')).toBe(true)

    act(() => {
      result.current.retryAll()
    })
    expect(FakeXHR.instances).toHaveLength(4)
    expect(result.current.items.every((i) => i.status !== 'error')).toBe(true)
  })
})
