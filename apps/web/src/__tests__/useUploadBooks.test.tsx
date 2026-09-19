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
  upload = { addEventListener: vi.fn() }
  private listeners = new Map<string, (() => void)[]>()

  open() {}
  send() {
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
})
