import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SystemInfoRes, SystemUpdateCheckRes, UpdateStatusRes } from '@bookdock/shared'

import { ApiError, apiGet, apiPost } from '@/api/client'
import AboutSettingsSection from '@/features/settings/components/AboutSettingsSection'
import i18n from '@/i18n/i18n'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, apiGet: vi.fn(), apiPost: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const CURRENT = '0.3.2'
const TARGET = '0.4.0'

function renderSection(statusQueue: UpdateStatusRes[]) {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/system/info') return { data: { version: CURRENT, repositoryUrl: 'https://github.com/x/y', releasesUrl: 'https://github.com/x/y/releases' } satisfies SystemInfoRes }
    const next = statusQueue.shift() ?? statusQueue[statusQueue.length - 1]
    return { data: next ?? { phase: 'idle', currentVersion: CURRENT } satisfies UpdateStatusRes }
  })
  vi.mocked(apiPost).mockClear()

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['system', 'info'], { data: { version: CURRENT, repositoryUrl: 'https://github.com/x/y', releasesUrl: 'https://github.com/x/y/releases' } satisfies SystemInfoRes })
  queryClient.setQueryData(['system', 'update-check'], {
    data: { status: 'update-available', currentVersion: CURRENT, latestVersion: TARGET, latestTag: `v${TARGET}`, releaseUrl: 'https://github.com/x/y/releases' } satisfies SystemUpdateCheckRes,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AboutSettingsSection />
    </QueryClientProvider>,
  )
}

describe('AboutSettingsSection in-app update', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('shows the 4-step pipeline before starting and reports the applied version', async () => {
    renderSection([{ phase: 'idle', currentVersion: TARGET, targetVersion: TARGET }])

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    expect(screen.getByText('创建数据快照')).toBeInTheDocument()
    expect(apiPost).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(vi.mocked(apiPost).mock.calls[0]).toEqual([
      '/system/update',
      { targetVersion: TARGET, progressId: expect.stringMatching(/^update-/) },
    ])
    expect(await screen.findByText(`已更新到 v${TARGET}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeInTheDocument()
  })

  it('shows why an update failed and offers a retry', async () => {
    renderSection([{ phase: 'failed', currentVersion: CURRENT, targetVersion: TARGET, error: { code: 'UPDATE_FAILED', message: 'Checksum mismatch' } }])

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    expect(await screen.findByText('更新失败，请重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2))
  })

  it('shows the extraction phase while the package is unpacking', async () => {
    renderSection([{ phase: 'extract', currentVersion: CURRENT, targetVersion: TARGET }])

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    expect(await screen.findByText('正在解压新版本…')).toBeInTheDocument()
  })

  it('surfaces a refused start without tracking a target', async () => {
    renderSection([])
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError('UPDATE_NOT_LAUNCHED', 'no launcher'))

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    expect(await screen.findByText('当前容器未由书坞启动器托管，无法应用内更新。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument()
  })
})
