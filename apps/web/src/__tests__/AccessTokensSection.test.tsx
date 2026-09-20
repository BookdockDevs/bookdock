import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { AccessToken, AccessTokenCreateRes } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'
import AccessTokensSection from '@/features/settings/components/AccessTokensSection'
import i18n from '@/i18n/i18n'

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(async () => ({ data: {} })),
  apiPost: vi.fn(async () => ({ data: {} })),
  apiDelete: vi.fn(async () => ({ data: null })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const LISTED: AccessToken = {
  id: 't1',
  name: '浏览器扩展',
  permissions: ['book:list', 'book:file'],
  tokenLast4: 'x7f2',
  createdAt: 1_700_000_000_000,
  expiresAt: 1_800_000_000_000,
  disabled: false,
}

function renderSection(tokens: AccessToken[] = []) {
  vi.mocked(apiGet).mockResolvedValue({ data: { tokens } })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessTokensSection />
    </QueryClientProvider>,
  )
}

describe('AccessTokensSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('shows an empty state when the user has no tokens', async () => {
    renderSection()

    expect(await screen.findByText('还没有访问令牌')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /创建令牌/ })[0]).toBeInTheDocument()
  })

  it('lists name, masked secret, permission labels and expiry', async () => {
    renderSection([LISTED])

    expect(await screen.findByText('浏览器扩展')).toBeInTheDocument()
    expect(screen.getByText(/x7f2/)).toBeInTheDocument()
    expect(screen.getByText(/浏览书库 · 下载书籍/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '禁用令牌' })).toHaveAttribute('aria-checked', 'true')
  })

  it('marks an expired token', async () => {
    renderSection([{ ...LISTED, expiresAt: 1, disabled: true }])

    expect(await screen.findByText('已过期')).toBeInTheDocument()
    expect(screen.getByTitle(/已于.*到期/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '启用令牌' })).toHaveAttribute('aria-checked', 'false')
  })

  it('creates a token with no permissions ticked by default and reveals the plaintext once', async () => {
    const created: AccessTokenCreateRes = {
      token: { ...LISTED, id: 't2', name: '新令牌', permissions: [], expiresAt: null },
      plaintext: 'bd_PLAINTEXT_ONLY_ONCE',
    }
    vi.mocked(apiPost).mockResolvedValue({ data: created })

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /创建令牌/ }))

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(4)
    for (const checkbox of checkboxes) expect(checkbox).not.toBeChecked()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新令牌' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/tokens', { name: '新令牌', permissions: [], expiresIn: '90d' }),
    )
    expect(await screen.findByDisplayValue('bd_PLAINTEXT_ONLY_ONCE')).toBeInTheDocument()
    expect(screen.getByText(/明文只显示这一次/)).toBeInTheDocument()
  })

  it('sends the ticked permissions and the chosen expiry', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      data: { token: { ...LISTED, id: 't3' }, plaintext: 'bd_x' } satisfies AccessTokenCreateRes,
    })

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /创建令牌/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '脚本' } })
    fireEvent.click(screen.getAllByRole('checkbox')[3]!)
    fireEvent.click(screen.getByRole('button', { name: '永久' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/tokens', { name: '脚本', permissions: ['book:upload'], expiresIn: 'permanent' }),
    )
  })

  it('disables a token from the row switch', async () => {
    renderSection([LISTED])

    fireEvent.click(await screen.findByRole('switch', { name: '禁用令牌' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/tokens/t1/disable', {}))
  })

  it('edits a token name, permissions and expiry', async () => {
    vi.mocked(apiPatch).mockResolvedValue({ data: { ...LISTED, name: '脚本', permissions: ['book:upload'] } })
    renderSection([LISTED])

    fireEvent.click(await screen.findByRole('button', { name: '编辑令牌' }))
    expect(screen.getByRole('heading', { name: '编辑访问令牌' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '脚本' } })
    fireEvent.click(screen.getAllByRole('checkbox')[3]!)
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getAllByRole('checkbox')[2]!)
    fireEvent.click(screen.getByRole('button', { name: '1 年' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/tokens/t1', {
        name: '脚本',
        permissions: ['book:upload'],
        expiresIn: '1y',
      }),
    )
  })

  it('deletes a token only after confirmation', async () => {
    renderSection([LISTED])

    fireEvent.click(await screen.findByRole('button', { name: '删除令牌' }))
    expect(screen.getByText('删除访问令牌')).toBeInTheDocument()
    expect(apiDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/tokens/t1'))
  })
})
