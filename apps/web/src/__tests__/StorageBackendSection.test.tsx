import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { apiGet, apiPost, apiPut } from '@/api/client'
import StorageBackendSection from '@/features/settings/components/StorageBackendSection'
import i18n from '@/i18n/i18n'

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({ data: { success: true, latencyMs: 38 } })),
  apiPut: vi.fn(async () => ({ data: {} })),
  apiDelete: vi.fn(async () => ({ data: {} })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const sampleLocalConfig = {
  enabled: false,
  connectionId: null,
  connectionName: null,
  connectionEndpoint: null,
  basePath: '/Bookdock/storage',
  cacheMaxMb: 2048,
  status: 'disabled' as const,
  totalBookCount: 25,
  totalBookBytes: 120000000,
  totalCoverBytes: 8000000,
  remoteBookCount: 0,
  remoteBytes: 0,
  localCachedCount: 0,
  localCachedBytes: 0,
  savedDiskBytes: 0,
  localTotalBytes: 128000000,
  availableDiskBytes: 50000000000,
}

const sampleRemoteConfig = {
  enabled: true,
  connectionId: 'conn_1',
  connectionName: '我的网盘',
  connectionEndpoint: 'https://dav.example.com',
  basePath: '/Bookdock/storage',
  cacheMaxMb: 2048,
  status: 'active' as const,
  latencyMs: 42,
  totalBookCount: 25,
  totalBookBytes: 120000000,
  totalCoverBytes: 8000000,
  remoteBookCount: 25,
  remoteBytes: 120000000,
  localCachedCount: 3,
  localCachedBytes: 15000000,
  savedDiskBytes: 105000000,
  localTotalBytes: 35000000,
}

const sampleConnections = [
  {
    id: 'conn_1',
    name: '我的网盘',
    provider: 'webdav',
    endpoint: 'https://dav.example.com',
    username: 'user1',
    basePath: '/books',
    hasSecrets: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
]

function renderSection(config = sampleLocalConfig, connections = sampleConnections) {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === '/integrations/storage-backend') {
      return { data: config }
    }
    if (path === '/integrations/storage-connections') {
      return { data: connections }
    }
    if (path === '/integrations/storage-backend/migration/status') {
      return {
        data: {
          status: 'idle',
          totalBooks: 25,
          migratedBooks: 0,
          freedBytes: 0,
        },
      }
    }
    return { data: {} }
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StorageBackendSection />
    </QueryClientProvider>,
  )
}

describe('StorageBackendSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('renders storage dashboard and current local mode', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('本地磁盘')).toBeInTheDocument()
    })

    expect(screen.getByText('存储管理')).toBeInTheDocument()
    expect(screen.getByText('本地总占用')).toBeInTheDocument()
    expect(screen.getByText('书籍文件')).toBeInTheDocument()
    expect(screen.getByText('本地可用空间')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更改存储位置' })).toBeInTheDocument()
  })

  it('opens modal, selects remote connection, probes and saves', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('本地磁盘')).toBeInTheDocument()
    })

    // Click to open modal via clickable capsule button
    fireEvent.click(screen.getByRole('button', { name: '更改存储位置' }))

    expect(screen.getByRole('heading', { name: '更改存储位置' })).toBeInTheDocument()

    // Save button is available and not blocked when nothing changed
    const saveButton = screen.getByText('保存')
    expect(saveButton).not.toBeDisabled()

    // Open target menu and select WebDAV connection
    const targetTrigger = screen.getByRole('button', { name: /存储目标/ })
    fireEvent.click(targetTrigger)

    const remoteOption = screen.getByText('我的网盘')
    fireEvent.click(remoteOption)

    // Action button changes to "测试" when remote target requires testing
    const testActionBtn = screen.getByRole('button', { name: '测试' })
    expect(testActionBtn).not.toBeDisabled()
    fireEvent.click(testActionBtn)

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-backend/test', {
        connectionId: 'conn_1',
        basePath: '/Bookdock/storage',
      })
    })

    // Button transforms to "保存" once test passes
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/integrations/storage-backend', {
        enabled: true,
        connectionId: 'conn_1',
        basePath: '/Bookdock/storage',
        cacheMaxMb: 2048,
      })
    })
  })

  it('renders remote active mode and allows cache clearing', async () => {
    renderSection(sampleRemoteConfig)

    await waitFor(() => {
      expect(screen.getByText(/我的网盘/)).toBeInTheDocument()
    })

    const clearBtn = screen.getByLabelText('清理本地缓存')
    fireEvent.click(clearBtn)

    const confirmBtn = screen.getByRole('button', { name: '确认清理' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-backend/clear-cache', {})
    })
  })
})
