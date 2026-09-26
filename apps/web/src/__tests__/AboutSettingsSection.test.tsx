import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SystemInfoRes, SystemUpdateCheckRes, UpdateStatusRes } from '@bookdock/shared'

import { ApiError, apiDelete, apiGet, apiPost } from '@/api/client'
import AboutSettingsSection from '@/features/settings/components/AboutSettingsSection'
import i18n from '@/i18n/i18n'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, apiDelete: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn() }
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
    renderSection([{ phase: 'extract', outcome: 'active', currentVersion: CURRENT, targetVersion: TARGET, action: 'Unpacking release files', extraction: { files: 2, bytes: 1024, totalFiles: 5 } }])

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    expect(await screen.findByText('正在解压新版本…')).toBeInTheDocument()
    expect(screen.getByText('Unpacking release files')).toBeInTheDocument()
    expect(screen.getByText('已处理 2 / 5 个文件，1.0 KB')).toBeInTheDocument()
  })

  it('cancels an active update before version switching', async () => {
    renderSection([{ phase: 'download', outcome: 'active', currentVersion: CURRENT, targetVersion: TARGET, progressId: 'update-progress', action: 'Receiving package data', download: { state: 'receiving', receivedBytes: 12 } }])
    vi.mocked(apiDelete).mockResolvedValueOnce({ data: { phase: 'cancelled', outcome: 'cancelled', currentVersion: CURRENT, targetVersion: TARGET } })

    fireEvent.click(await screen.findByRole('button', { name: '查看更新状态' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消更新' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/system/update/update-progress'))
    expect(await screen.findByText('更新已取消，当前仍运行旧版本。')).toBeInTheDocument()
  })

  it('surfaces a refused start without tracking a target', async () => {
    renderSection([])
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError('UPDATE_NOT_LAUNCHED', 'no launcher'))

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认更新' }))

    expect(await screen.findByText('当前容器未由书坞启动器托管，无法应用内更新。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument()
  })

  it('retries a stale failed job against the latest release instead of replaying it', async () => {
    renderSection([{ phase: 'failed', outcome: 'failed', currentVersion: CURRENT, targetVersion: '0.3.6', error: { code: 'UPDATE_FAILED', message: 'old failure' } }])

    fireEvent.click(await screen.findByRole('button', { name: '查看更新状态' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '重试' }))

    // The stored job targets 0.3.6 but the check reports TARGET: retry must
    // follow latest (the server rejects non-latest targets outright).
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(vi.mocked(apiPost).mock.calls[0]).toEqual([
      '/system/update',
      { targetVersion: TARGET, progressId: expect.stringMatching(/^update-/) },
    ])
  })

  it('shows a single banner and close button when a retry fails on a failed job', async () => {
    renderSection([{ phase: 'failed', outcome: 'failed', currentVersion: CURRENT, targetVersion: TARGET, error: { code: 'UPDATE_FAILED', message: 'Checksum mismatch' } }])
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError('UPDATE_NOT_AVAILABLE', 'gone'))

    fireEvent.click(await screen.findByRole('button', { name: '查看更新状态' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '重试' }))

    expect(await screen.findByText('该版本暂时无法通过应用内更新获取，请重新检查更新或改用 docker compose pull。')).toBeInTheDocument()
    // The fresh start error supersedes the stale settled box: no duplicate
    // banner, and exactly one footer Close next to the header X.
    expect(screen.queryByText('Checksum mismatch')).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' })).toHaveLength(2)
  })

  it('localizes server-sent download progress instead of leaking English', async () => {
    renderSection([{ phase: 'download', outcome: 'active', currentVersion: CURRENT, targetVersion: TARGET, action: 'Release server responded; receiving package data', download: { state: 'receiving', receivedBytes: 1024, totalBytes: 2048 } }])

    fireEvent.click(await screen.findByRole('button', { name: '查看更新状态' }))

    // The raw server string must not leak anywhere in the dialog.
    expect(await screen.findByText('已收到响应，正在接收')).toBeInTheDocument()
    expect(screen.queryByText('Release server responded; receiving package data')).not.toBeInTheDocument()
  })

  it('copies version number and updates badge to show copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderSection([])
    const versionBtn = screen.getByRole('button', { name: `v${CURRENT}` })
    fireEvent.click(versionBtn)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CURRENT))
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
  })

  it('copies system diagnostic info and updates button to show copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderSection([])
    const diagBtn = screen.getByRole('button', { name: '复制诊断信息' })
    fireEvent.click(diagBtn)

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toContain('### Bookdock System Diagnostic')
    expect(writeText.mock.calls[0][0]).toContain(`- Version: ${CURRENT}`)
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
  })
})
