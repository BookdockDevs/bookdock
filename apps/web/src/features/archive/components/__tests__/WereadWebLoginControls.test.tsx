import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet, apiPost } from '@/api/client'
import { notify } from '@/lib/notifications'
import WereadWebLoginControls from '../WereadWebLoginControls'

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,qr') },
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

function renderControls() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WereadWebLoginControls />
    </QueryClientProvider>,
  )
}

describe('WereadWebLoginControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiGet).mockImplementation(async () => ({ data: { status: 'pending', session: null } }))
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      // Mounting the web channel verifies the stored session first.
      if (path === '/reading-imports/weread/web-session/verify') return { data: { configured: false, vid: null, updatedAt: null, valid: true } }
      if (path === '/reading-imports/weread/web-login') {
        return { data: { id: 'login-1', confirmUrl: 'https://weread.qq.com/web/confirm?pf=2&uid=one-time', expiresAt: Date.now() + 60_000 } }
      }
      return { data: { status: 'pending', session: null } }
    })
  })

  it('verifies the stored session when the web channel opens', async () => {
    renderControls()

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/web-session/verify', {}))
    expect(await screen.findByRole('button', { name: 'readingImport.webQrLogin' })).toBeInTheDocument()
  })

  it('shows a locally generated QR after starting sign-in and polls the caller session', async () => {
    renderControls()
    fireEvent.click(await screen.findByRole('button', { name: 'readingImport.webQrLogin' }))

    expect(await screen.findByRole('img', { name: 'readingImport.webQrAlt' })).toHaveAttribute('src', 'data:image/png;base64,qr')
    expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/web-login', {})
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/reading-imports/weread/web-login/login-1'))
    expect(screen.getByText('readingImport.webQrInstructions')).toBeInTheDocument()
  })

  it('skips the login prompt when a saved session already exists', async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      if (path === '/reading-imports/weread/web-session/verify') return { data: { configured: true, vid: '306734116', updatedAt: Date.now(), valid: true } }
      return { data: { status: 'pending', session: null } }
    })

    renderControls()

    // A connected session offers disconnect; there is no cookie view and no
    // paste fallback — QR sign-in is the only way in.
    expect(await screen.findByRole('button', { name: 'readingImport.webDisconnect' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'readingImport.webQrLogin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'readingImport.webCookieView' })).not.toBeInTheDocument()
  })

  it('returns to the logged-out UI once verification reports the session invalid', async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      // The cookie stays on the server, but the UI only offers a fresh login.
      if (path === '/reading-imports/weread/web-session/verify') return { data: { configured: true, vid: '306734116', updatedAt: Date.now(), valid: false } }
      return { data: { status: 'pending', session: null } }
    })

    renderControls()

    expect(await screen.findByRole('button', { name: 'readingImport.webQrLogin' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'readingImport.webDisconnect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'readingImport.webCookieView' })).not.toBeInTheDocument()
  })

  it('dispatches a success toast and leaves no inline message when sign-in completes', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/reading-imports/weread/web-login/login-1') {
        return { data: { status: 'complete', session: null } }
      }
      return { data: { status: 'pending', session: null } }
    })

    renderControls()
    fireEvent.click(await screen.findByRole('button', { name: 'readingImport.webQrLogin' }))

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('readingImport.webLoginDone')
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows checking state while verifying session and disables login action', () => {
    vi.mocked(apiPost).mockImplementation(() => new Promise(() => {}))
    renderControls()

    expect(screen.getByText('readingImport.webSessionChecking')).toBeInTheDocument()
    const checkingBtn = screen.getByRole('button', { name: 'readingImport.webSessionCheckingShort' })
    expect(checkingBtn).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'readingImport.webQrLogin' })).not.toBeInTheDocument()
  })
})
