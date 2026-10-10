import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import StorageConnectionsSection from '@/features/settings/components/StorageConnectionsSection'
import i18n from '@/i18n/i18n'
import { notify } from '@/lib/notifications'

vi.mock('@/api/client', () => ({
  apiDelete: vi.fn(async () => ({ data: { success: true } })),
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({ data: { success: true, latencyMs: 45 } })),
  apiPut: vi.fn(async () => ({ data: {} })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const sampleConnections = [
  {
    id: 'conn_1',
    name: '坚果云',
    provider: 'webdav',
    endpoint: 'https://dav.jianguoyun.com/dav/',
    username: 'user1',
    basePath: '/books',
    hasSecrets: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'conn_2',
    name: '家庭 NAS',
    provider: 'webdav',
    endpoint: 'http://nas.local:5005',
    username: 'nasuser',
    basePath: '/',
    hasSecrets: true,
    createdAt: 2000,
    updatedAt: 2000,
  },
]

function renderSection(connections: unknown[] = sampleConnections) {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === '/integrations/storage-connections') {
      return { data: connections }
    }
    return { data: {} }
  })
  vi.mocked(apiDelete).mockClear()
  vi.mocked(apiPut).mockClear()
  vi.mocked(apiPost).mockClear()

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <StorageConnectionsSection />
    </QueryClientProvider>,
  )
}

describe('StorageConnectionsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders empty state when no connections configured', async () => {
    renderSection([])

    await waitFor(() => {
      expect(screen.getByText('暂无外部存储')).toBeInTheDocument()
    })
  })

  it('renders connection list with details', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('坚果云')).toBeInTheDocument()
      expect(screen.getByText('家庭 NAS')).toBeInTheDocument()
    })
    expect(screen.getByText('https://dav.jianguoyun.com/dav/')).toBeInTheDocument()
  })

  it('triggers connection test and shows latency', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('坚果云')).toBeInTheDocument()
    })

    const testButtons = screen.getAllByRole('button', { name: /测试/ })
    fireEvent.click(testButtons[0])

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-connections/conn_1/test', {})
    })

    await waitFor(() => {
      expect(screen.getByText('45ms')).toBeInTheDocument()
    })
    expect(notify.success).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'settings.storageConnectionsTestSuccess',
      }),
    )
  })

  it('deletes connection upon confirmation', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('坚果云')).toBeInTheDocument()
    })

    const deleteBtn = screen.getAllByRole('button', { name: /删除/ })[0]
    expect(deleteBtn).toBeDefined()

    fireEvent.click(deleteBtn)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(apiDelete).not.toHaveBeenCalled()

    const confirmBtn = within(dialog).getByRole('button', { name: '删除' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/integrations/storage-connections/conn_1')
    })
    expect(notify.success).toHaveBeenCalled()
  })

  it('opens edit modal and saves changes', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('坚果云')).toBeInTheDocument()
    })

    const editBtn = screen.getAllByRole('button', { name: /编辑/ })[0]
    fireEvent.click(editBtn)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const nameInput = screen.getByDisplayValue('坚果云')
    fireEvent.change(nameInput, { target: { value: '我的坚果云' } })

    const saveBtn = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/integrations/storage-connections/conn_1', expect.objectContaining({
        name: '我的坚果云',
      }))
    })
    expect(notify.success).toHaveBeenCalled()
  })

  it('tests connection inside edit modal and displays latency', async () => {
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('坚果云')).toBeInTheDocument()
    })

    const editBtn = screen.getAllByRole('button', { name: /编辑/ })[0]
    fireEvent.click(editBtn)

    await waitFor(() => {
      expect(screen.getByDisplayValue('坚果云')).toBeInTheDocument()
    })

    const dialog = screen.getByRole('dialog')
    const modalTestBtn = within(dialog).getByRole('button', { name: /测试/ })
    fireEvent.click(modalTestBtn)

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/integrations/storage-connections/conn_1/test', expect.objectContaining({
        endpoint: 'https://dav.jianguoyun.com/dav/',
        username: 'user1',
      }))
    })

    await waitFor(() => {
      expect(screen.getByText('45ms')).toBeInTheDocument()
    })
  })
})
