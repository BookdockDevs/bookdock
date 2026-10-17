import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { apiGet, apiPost } from '@/api/client'
import WebDavImportBrowser from '@/features/library/components/WebDavImportBrowser'
import i18n from '@/i18n/i18n'
import { notify } from '@/lib/notifications'

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

const defaultConnections = [
  {
    id: 'conn_1',
    name: 'My WebDAV',
    provider: 'webdav',
    endpoint: 'https://dav.test.com',
    username: 'testuser',
    basePath: '/',
    hasSecrets: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
]

function renderBrowser(
  connections: unknown[] = defaultConnections,
  entries: unknown[] = [],
  importHandler?: (body: unknown, signal?: AbortSignal) => Promise<unknown>,
  options?: { strictMode?: boolean; onImportComplete?: (ids: string[]) => void },
) {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === '/integrations/storage-connections') {
      return { data: connections }
    }
    return { data: {} }
  })

  vi.mocked(apiPost).mockImplementation(async (path, body, signal) => {
    if (path.endsWith('/ls')) {
      return { data: entries }
    }
    if (path.endsWith('/import')) {
      if (importHandler) return importHandler(body, signal)
      const importedPath = (body as { files?: string[] })?.files?.[0] || '/book.epub'
      return {
        data: {
          results: [{ path: importedPath, name: importedPath.split('/').pop() || 'book.epub', status: 'success', bookId: 'b1' }],
          total: 1,
          successCount: 1,
          duplicateCount: 0,
          errorCount: 0,
        },
      }
    }
    return { data: {} }
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const content = (
    <QueryClientProvider client={queryClient}>
      <WebDavImportBrowser onImportComplete={options?.onImportComplete} />
    </QueryClientProvider>
  )
  return render(options?.strictMode ? <React.StrictMode>{content}</React.StrictMode> : content)
}

describe('WebDavImportBrowser', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('shows not configured notice when no storage connections exist', async () => {
    renderBrowser([])

    await waitFor(() => {
      expect(screen.getByText(/未配置外部存储/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /前往设置连接/ })).toBeInTheDocument()
  })

  it('lists files and directories when configured with a connection', async () => {
    renderBrowser(
      defaultConnections,
      [
        { name: 'SciFi', path: '/SciFi', type: 'dir', size: 0, isSupported: false },
        { name: 'three-body.epub', path: '/three-body.epub', type: 'file', size: 500000, isSupported: true },
      ],
    )

    await waitFor(() => {
      expect(screen.getByText('SciFi')).toBeInTheDocument()
      expect(screen.getByText('three-body.epub')).toBeInTheDocument()
    })
    expect(screen.getByText(/选择存储/)).toBeInTheDocument()
  })

  it('selects all available books and triggers import from selected connection in StrictMode', async () => {
    const onImportComplete = vi.fn()
    renderBrowser(
      defaultConnections,
      [
        { name: 'novel.epub', path: '/novel.epub', type: 'file', size: 1000, isSupported: true },
      ],
      undefined,
      { strictMode: true, onImportComplete },
    )

    await waitFor(() => {
      expect(screen.getByText('novel.epub')).toBeInTheDocument()
    })

    const selectAllCheckbox = screen.getByRole('checkbox', { name: /全选/ })
    fireEvent.click(selectAllCheckbox)

    const importBtn = screen.getByRole('button', { name: /开始导入/ })
    expect(importBtn).not.toBeDisabled()

    fireEvent.click(importBtn)

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-connections/conn_1/import', expect.objectContaining({
        files: ['/novel.epub'],
      }), expect.anything())
    })

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalled()
    })
    expect(onImportComplete).toHaveBeenCalledWith(['b1'])
    await waitFor(() => {
      expect(screen.getAllByText('完成').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByRole('button', { name: /开始阅读/ })).toBeInTheDocument()
    })
  })

  it('settles queue items, updates UI status, releases lock and triggers onImportComplete in StrictMode', async () => {
    const onImportComplete = vi.fn()
    renderBrowser(
      defaultConnections,
      [
        { name: 'book-a.epub', path: '/book-a.epub', type: 'file', size: 1000, isSupported: true },
      ],
      () => Promise.resolve({
        data: {
          results: [{ path: '/book-a.epub', name: 'book-a.epub', status: 'success', bookId: 'b-strict' }],
          total: 1,
          successCount: 1,
          duplicateCount: 0,
          errorCount: 0,
        },
      }),
      { strictMode: true, onImportComplete },
    )

    await waitFor(() => expect(screen.getByText('book-a.epub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: /全选/ }))
    const importBtn = screen.getByRole('button', { name: /开始导入/ })
    fireEvent.click(importBtn)

    await waitFor(() => {
      expect(screen.getByText('完成')).toBeInTheDocument()
    })
    expect(onImportComplete).toHaveBeenCalledWith(['b-strict'])
    expect(notify.success).toHaveBeenCalled()

    // Lock is released so drive selector is enabled
    expect(screen.getByRole('combobox')).not.toBeDisabled()
  })

  it('keeps the queue lock until an aborted request settles and does not start the next item', async () => {
    let calls = 0
    let rejectFirst: ((reason?: unknown) => void) | undefined
    const first = new Promise<unknown>((_resolve, reject) => { rejectFirst = reject })
    renderBrowser(
      defaultConnections,
      [
        { name: 'one.epub', path: '/one.epub', type: 'file', size: 1000, isSupported: true },
        { name: 'two.epub', path: '/two.epub', type: 'file', size: 1000, isSupported: true },
      ],
      (_body, signal) => {
        calls++
        if (calls === 1) {
          signal?.addEventListener('abort', () => rejectFirst?.(new DOMException('Aborted', 'AbortError')), { once: true })
          return first
        }
        return Promise.resolve({ data: { results: [{ status: 'success', bookId: 'b2' }] } })
      },
    )

    await waitFor(() => expect(screen.getByText('one.epub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: /全选/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() => expect(calls).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: /取消上传/ }))
    // While the aborted in-flight request is still pending, controls must stay locked
    expect(screen.getByRole('button', { name: /取消上传/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试全部失败/ })).not.toBeInTheDocument()
    expect(calls).toBe(1)

    // Now settle the aborted in-flight request
    rejectFirst?.(new DOMException('Aborted', 'AbortError'))
    await waitFor(() => expect(screen.getAllByText(/已取消/).length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('button', { name: /取消上传/ })).not.toBeInTheDocument())
    expect(calls).toBe(1)
  })

  it('keeps a late successful response truthful after cancellation', async () => {
    let resolveImport: ((value: unknown) => void) | undefined
    const pending = new Promise<unknown>((resolve) => { resolveImport = resolve })
    renderBrowser(
      defaultConnections,
      [{ name: 'late.epub', path: '/late.epub', type: 'file', size: 1000, isSupported: true }],
      () => pending,
    )

    await waitFor(() => expect(screen.getByText('late.epub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: /全选/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始导入/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /取消上传/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /取消上传/ }))
    resolveImport?.({ data: { results: [{ status: 'success', bookId: 'late-book' }] } })

    await waitFor(() => expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument())
    expect(screen.queryByText(/服务端可能已完成导入/)).not.toBeInTheDocument()
  })

  it('switches drive connection when multiple drives are available', async () => {
    const multiConnections = [
      ...defaultConnections,
      {
        id: 'conn_2',
        name: 'NAS Drive',
        provider: 'webdav',
        endpoint: 'http://nas:5000',
        username: 'admin',
        basePath: '/books',
        hasSecrets: true,
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]

    renderBrowser(multiConnections, [])

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('conn_1')

    fireEvent.change(select, { target: { value: 'conn_2' } })
    expect(select).toHaveValue('conn_2')
  })

  it('switches drive connection when selecting an option from the custom SmartMenu', async () => {
    const multiConnections = [
      ...defaultConnections,
      {
        id: 'conn_2',
        name: 'NAS Drive',
        provider: 'webdav',
        endpoint: 'http://nas:5000',
        username: 'admin',
        basePath: '/books',
        hasSecrets: true,
        createdAt: 2000,
        updatedAt: 2000,
      },
    ]

    renderBrowser(multiConnections, [])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /My WebDAV/ })).toBeInTheDocument()
    })

    const triggerBtn = screen.getByRole('button', { name: /My WebDAV/ })
    fireEvent.click(triggerBtn)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /NAS Drive/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /NAS Drive/ }))

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('conn_2')
    })
  })

  it('renders refresh button with proper Chinese tooltip/label', async () => {
    renderBrowser(defaultConnections, [])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
    })
  })

  it('restores last connection and directory path from sessionStorage cache', async () => {
    sessionStorage.setItem('bookdock:webdav_browser_cache', JSON.stringify({
      lastConnectionId: 'conn_1',
      paths: { conn_1: '/SciFi/SubFolder' },
    }))

    renderBrowser(defaultConnections, [
      { name: 'deep.epub', path: '/SciFi/SubFolder/deep.epub', type: 'file', size: 1000, isSupported: true },
    ])

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-connections/conn_1/ls', {
        path: '/SciFi/SubFolder',
      })
      expect(screen.getByText('deep.epub')).toBeInTheDocument()
    })

    // Breadcrumbs should render the subfolder path
    expect(screen.getByText('SciFi')).toBeInTheDocument()
    expect(screen.getByText('SubFolder')).toBeInTheDocument()

    // Up button should be present
    expect(screen.getByRole('button', { name: /返回上一级/ })).toBeInTheDocument()
  })

  it('filters out unsupported files and shows empty notice when only non-book files exist', async () => {
    renderBrowser(defaultConnections, [
      { name: 'movie.mp4', path: '/movie.mp4', type: 'file', size: 1024 * 1024 * 50, isSupported: false },
      { name: 'archive.zip', path: '/archive.zip', type: 'file', size: 1024 * 1024 * 10, isSupported: false },
    ])

    await waitFor(() => {
      expect(screen.getByText(/此目录下没有文件/)).toBeInTheDocument()
    })

    // Neither unsupported file should appear in the list
    expect(screen.queryByText('movie.mp4')).not.toBeInTheDocument()
    expect(screen.queryByText('archive.zip')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    // Import button should be disabled
    expect(screen.getByRole('button', { name: /开始导入/ })).toBeDisabled()
  })

  it('filters current directory entries using inline search input', async () => {
    renderBrowser(defaultConnections, [
      { name: 'three-body.epub', path: '/three-body.epub', type: 'file', size: 1000, isSupported: true },
      { name: 'foundation.epub', path: '/foundation.epub', type: 'file', size: 2000, isSupported: true },
    ])

    await waitFor(() => {
      expect(screen.getByText('three-body.epub')).toBeInTheDocument()
      expect(screen.getByText('foundation.epub')).toBeInTheDocument()
    })

    // Open search
    const searchBtn = screen.getByRole('button', { name: /搜索当前目录/ })
    fireEvent.click(searchBtn)

    const searchInput = screen.getByPlaceholderText(/搜索当前目录/)
    fireEvent.change(searchInput, { target: { value: 'three' } })

    expect(screen.getByText('three-body.epub')).toBeInTheDocument()
    expect(screen.queryByText('foundation.epub')).not.toBeInTheDocument()

    // Clear search
    const clearBtn = screen.getByRole('button', { name: /清除搜索/ })
    fireEvent.click(clearBtn)

    expect(screen.getByText('three-body.epub')).toBeInTheDocument()
    expect(screen.getByText('foundation.epub')).toBeInTheDocument()
  })

  it('navigates to parent directory when pressing Backspace outside inputs', async () => {
    sessionStorage.setItem('bookdock:webdav_browser_cache', JSON.stringify({
      lastConnectionId: 'conn_1',
      paths: { conn_1: '/SciFi/SubFolder' },
    }))

    renderBrowser(defaultConnections, [])

    await waitFor(() => {
      expect(screen.getByText('SubFolder')).toBeInTheDocument()
    })

    // Press Backspace
    fireEvent.keyDown(window, { key: 'Backspace' })

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-connections/conn_1/ls', {
        path: '/SciFi',
      })
    })
  })
})



