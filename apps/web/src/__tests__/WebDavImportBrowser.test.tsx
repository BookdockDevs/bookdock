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

function renderBrowser(connections: unknown[] = defaultConnections, entries: unknown[] = []) {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === '/integrations/storage-connections') {
      return { data: connections }
    }
    return { data: {} }
  })

  vi.mocked(apiPost).mockImplementation(async (path) => {
    if (path.endsWith('/ls')) {
      return { data: entries }
    }
    if (path.endsWith('/import')) {
      return {
        data: {
          results: [{ path: '/book.epub', name: 'book.epub', status: 'success', bookId: 'b1' }],
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
  return render(
    <QueryClientProvider client={queryClient}>
      <WebDavImportBrowser />
    </QueryClientProvider>,
  )
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

  it('selects all available books and triggers import from selected connection', async () => {
    renderBrowser(
      defaultConnections,
      [
        { name: 'novel.epub', path: '/novel.epub', type: 'file', size: 1000, isSupported: true },
      ],
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
      }))
    })

    expect(notify.success).toHaveBeenCalled()
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



