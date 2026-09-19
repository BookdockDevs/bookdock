import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import { apiGet, apiPost, apiPut } from '@/api/client'
import LegadoSettingsSection from '@/features/settings/components/LegadoSettingsSection'
import i18n from '@/i18n/i18n'

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(async () => ({ data: {} })),
  apiPut: vi.fn(async () => ({ data: {} })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

function renderSection(integrations?: SettingsRes['integrations']) {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === '/settings') return { data: { integrations } } as { data: SettingsRes }
    return {
      data: {
        active: true,
        createdAt: 100,
        expiresAt: null,
        sourceUrl: 'http://bookdock.test/api/v1/legado/source.json?key=bd_src_secret',
        importUrl: 'legado://import/bookSource?src=encoded',
      },
    }
  })
  vi.mocked(apiPut).mockClear()
  vi.mocked(apiPost).mockClear()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings'], { data: { integrations } satisfies SettingsRes })
  return render(
    <QueryClientProvider client={queryClient}>
      <LegadoSettingsSection />
    </QueryClientProvider>,
  )
}

describe('LegadoSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders disabled by default without source URL or actions', () => {
    renderSection(undefined)

    expect(screen.getByRole('heading', { name: '开源阅读' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '启用开源阅读书源服务' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('书源地址')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '一键导入' })).not.toBeInTheDocument()
  })

  it('toggles disabled and calls apiPut', async () => {
    renderSection({ legado: { enabled: true } })

    const toggle = screen.getByRole('switch', { name: '启用开源阅读书源服务' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/settings', {
        integrations: { legado: { enabled: false } },
      })
    })
  })

  it('hides source url when disabled', () => {
    renderSection({ legado: { enabled: false } })

    expect(screen.getByRole('switch', { name: '启用开源阅读书源服务' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('书源地址')).not.toBeInTheDocument()
    expect(screen.queryByText('一键导入')).not.toBeInTheDocument()
  })

  it('copies source URL to clipboard on copy button click', async () => {
    renderSection({ legado: { enabled: true } })

    const copyBtn = screen.getByRole('button', { name: '复制' })
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/legado/source.json'),
      )
    })
  })

  it('loads and displays a sign-in-free source link automatically', async () => {
    renderSection({ legado: { enabled: true, authMode: 'accessKey' } })

    expect(screen.getByRole('switch', { name: '免登录访问' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('key=bd_src_secret')
    })
  })

  it('displays loading indicator and disabled actions while fetching sign-in-free key', async () => {
    let resolveKey!: () => void
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/settings') {
        return { data: { integrations: { legado: { enabled: true, authMode: 'accessKey' } } } } as { data: SettingsRes }
      }
      return new Promise((resolve) => {
        resolveKey = () => resolve({
          data: {
            active: true,
            createdAt: 100,
            expiresAt: null,
            sourceUrl: 'http://bookdock.test/api/v1/legado/source.json?key=bd_src_delayed',
            importUrl: 'legado://import/bookSource?src=delayed',
          },
        })
      })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['settings'], {
      data: { integrations: { legado: { enabled: true, authMode: 'accessKey' } } } satisfies SettingsRes,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <LegadoSettingsSection />
      </QueryClientProvider>,
    )

    expect(screen.getByText('正在获取书源凭证...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()

    resolveKey()
    await waitFor(() => {
      expect(screen.queryByText('正在获取书源凭证...')).not.toBeInTheDocument()
      expect((screen.getByRole('textbox') as HTMLInputElement).value).toContain('bd_src_delayed')
    })
  })

  it('toggles sign-in-free access mode', async () => {
    renderSection({ legado: { enabled: true, authMode: 'login' } })

    const toggle = screen.getByRole('switch', { name: '免登录访问' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/settings', {
        integrations: { legado: { authMode: 'accessKey' } },
      })
    })
  })

  it('rotates the sign-in-free link after confirmation dialog', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({
      data: {
        sourceUrl: 'http://bookdock.test/api/v1/legado/source.json?key=bd_src_new',
        importUrl: 'legado://import/bookSource?src=new_encoded',
        createdAt: 200,
        expiresAt: null,
      },
    })
    renderSection({ legado: { enabled: true, authMode: 'accessKey' } })

    const rotateBtn = await screen.findByRole('button', { name: '重新生成' })
    await waitFor(() => expect(rotateBtn).not.toBeDisabled())
    fireEvent.click(rotateBtn)

    // Confirm dialog appears with warning
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('确定要重新生成免登录书源链接吗？')).toBeInTheDocument()

    // Cancel doesn't trigger rotation
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    fireEvent.click(cancelBtn)
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // Open again and confirm
    fireEvent.click(rotateBtn)
    const confirmBtn = screen.getAllByRole('button', { name: '重新生成' }).find((b) => b.closest('[role="alertdialog"]'))!
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/legado/access-key', {})
    })
  })

  it('shows QR code modal on desktop when clicking scan to import', async () => {
    renderSection({ legado: { enabled: true } })

    const qrBtn = screen.getByRole('button', { name: '扫码导入' })
    fireEvent.click(qrBtn)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('书源扫码导入')).toBeInTheDocument()
      expect(screen.getByText('打开开源阅读「书源管理 - 二维码导入」')).toBeInTheDocument()
    })
  })

  it('shows one-click import link on mobile devices', () => {
    const originalUserAgent = navigator.userAgent
    try {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
        configurable: true,
      })
      renderSection({ legado: { enabled: true } })

      expect(screen.getByRole('link', { name: '一键导入' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '扫码导入' })).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })

  it('toggles EPUB media inclusion', async () => {
    renderSection({ legado: { enabled: true, includeEpubMedia: true } })

    const toggle = screen.getByRole('switch', { name: '包含插图与媒体' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/settings', {
        integrations: { legado: { includeEpubMedia: false } },
      })
    })
  })
})
