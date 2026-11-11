import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientLibraryBookView } from '@bookdock/shared'

import { ContextMenuContent } from '@/features/library/components/BookContextMenu'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'

import { remoteCacheScopeKey } from './remote-book-cache'
import { useRemoteCacheStore } from './remote-cache.store'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', async () => ({
  ...await import('@/__tests__/mocks/router-link'),
  useNavigate: () => navigateMock,
}))

const serverBook: ClientLibraryBookView = {
  id: 'srv-1',
  title: 'Server Novel',
  author: 'Alice',
  authors: ['Alice'],
  format: 'epub',
  coverKey: null,
  size: 1024,
  readStatus: 'reading',
  progress: 20,
  createdAt: 1000,
  updatedAt: 2000,
  shelfId: null,
  effectiveHidden: false,
  hiddenReason: null,
}

const deviceBook: ClientLibraryBookView = {
  ...serverBook,
  id: 'loc-1',
  title: 'Local Novel',
  ref: { scope: { kind: 'local', vaultId: 'default' }, bookId: 'loc-1' },
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('indexedDB', new IDBFactory())
  useAuthStore.setState({ user: { id: 'u1', username: 'alice', role: 'owner' } })
  useRemoteCacheStore.setState({
    scopeKey: remoteCacheScopeKey('u1'),
    hydrated: true,
    cached: {},
    tasks: {},
    pendingSync: {},
  })
})

describe('ContextMenuContent cache and upload actions', () => {
  it('renders 缓存 -> 缓存中 with circular progress ring -> 清除缓存 -> 更新缓存 in ContextMenuContent', () => {
    const cacheBookSpy = vi.fn(async () => true)
    const removeCacheSpy = vi.fn(async () => undefined)
    useRemoteCacheStore.setState({ cacheBook: cacheBookSpy, removeCache: removeCacheSpy })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onClose = vi.fn()

    const { rerender, container } = render(
      <QueryClientProvider client={queryClient}>
        <ContextMenuContent book={serverBook} readOnly onClose={onClose} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '缓存' }))
    expect(cacheBookSpy).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      useRemoteCacheStore.setState({
        tasks: { 'srv-1': { status: 'caching', progress: 45, revisionId: 'rev-1' } },
      })
    })
    expect(screen.getByRole('button', { name: '缓存中' })).toBeInTheDocument()
    expect(container.querySelectorAll('svg circle')).toHaveLength(2)

    act(() => {
      useRemoteCacheStore.setState({
        tasks: {},
        cached: {
          'srv-1': {
            bookId: 'srv-1',
            scopeKey: remoteCacheScopeKey('u1'),
            revisionId: 'rev-1',
            contentUpdatedAt: 2000,
            cachedAt: 3000,
            size: 1024,
            promptedUpdateRevisionId: null,
            title: 'Server Novel',
          },
        },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: '清除缓存' }))
    expect(removeCacheSpy).toHaveBeenCalledWith('srv-1', 'u1')

    act(() => {
      useRemoteCacheStore.setState({
        cached: {
          'srv-1': {
            bookId: 'srv-1',
            scopeKey: remoteCacheScopeKey('u1'),
            revisionId: 'rev-1',
            contentUpdatedAt: 2000,
            cachedAt: 3000,
            size: 1024,
            promptedUpdateRevisionId: 'rev-2',
            title: 'Server Novel',
          },
        },
      })
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <ContextMenuContent book={serverBook} readOnly onClose={onClose} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: '更新缓存' })).toBeInTheDocument()
    const clearExpiredBtn = screen.getByRole('button', { name: '清除缓存' })
    fireEvent.click(clearExpiredBtn)
    expect(removeCacheSpy).toHaveBeenCalledTimes(2)
  })

  it('shows 上传 for eligible device books in ContextMenuContent', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onUploadToServer = vi.fn()
    const onClose = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <ContextMenuContent book={deviceBook} onUploadToServer={onUploadToServer} onClose={onClose} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '上传' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onUploadToServer).toHaveBeenCalledWith(deviceBook)
  })
})
