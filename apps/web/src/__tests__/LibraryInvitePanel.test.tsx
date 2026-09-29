import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryInvitePanel from '../features/library/components/LibraryInvitePanel'
import i18n from '../i18n/i18n'

const API = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('@/api/client', () => ({ apiGet: API.get, apiPost: API.post, apiDelete: API.delete }))

const TOKEN = 'K7M2QX9V4TN8BZRD'
const NEXT_TOKEN = 'J4W8HY3D6RC5NSPA'
const LINK = `${window.location.origin}/library/+${TOKEN}`

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LibraryInvitePanel libraryId="lib_1" /></QueryClientProvider>)
}

describe('LibraryInvitePanel', () => {
  const writeText = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    API.get.mockResolvedValue({ data: { active: true, createdAt: 1, token: TOKEN } })
  })

  it('shows the existing invitation link whenever management reopens', async () => {
    const first = renderPanel()
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument()
    first.unmount()

    renderPanel()
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument()
    expect(API.post).not.toHaveBeenCalled()
  })

  it('drops the expiry badge and the explanatory hint', async () => {
    renderPanel()
    await screen.findByDisplayValue(LINK)
    expect(screen.queryByText('长期有效')).not.toBeInTheDocument()
    expect(screen.queryByText(/持链接的已登录用户确认后即可加入/)).not.toBeInTheDocument()
  })

  it('copies the link from the icon button', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
  })

  it('replaces the link from the regenerate icon', async () => {
    API.post.mockResolvedValue({ data: { token: NEXT_TOKEN, createdAt: 2 } })
    renderPanel()
    await screen.findByDisplayValue(LINK)

    fireEvent.click(screen.getByRole('button', { name: '重新生成链接' }))
    await waitFor(() => expect(API.post).toHaveBeenCalledWith('/libraries/lib_1/invite'))
    await waitFor(() => expect(screen.getByDisplayValue(`${window.location.origin}/library/+${NEXT_TOKEN}`)).toBeInTheDocument())
  })

  it('revokes the link and only offers re-activation afterwards', async () => {
    API.delete.mockResolvedValue({ data: { active: false, createdAt: null, token: null } })
    renderPanel()
    await screen.findByDisplayValue(LINK)

    fireEvent.click(screen.getByRole('button', { name: '撤销链接' }))
    await waitFor(() => expect(API.delete).toHaveBeenCalledWith('/libraries/lib_1/invite'))
    // Revocation keeps the row, so the link empties out and only re-activation works.
    await waitFor(() => expect(screen.getByPlaceholderText('链接已撤销')).toBeDisabled())
    expect(screen.getByRole('button', { name: '复制链接' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重新启用邀请链接' })).toBeInTheDocument()
  })
})
