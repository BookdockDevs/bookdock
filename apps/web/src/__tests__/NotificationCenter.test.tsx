import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InteractionNotification } from '@bookdock/shared'

import * as api from '@/api/client'
import NotificationCenter from '@/features/notifications/NotificationCenter'
import NotificationBell from '@/features/notifications/components/NotificationBell'
import { useReviewAction } from '@/features/reviews/hooks/useReviews'
import { useIdeaAction } from '@/features/reader/hooks/useIdeas'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'

let search: { page: number; id?: string } = { page: 1 }
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search, useNavigate: () => navigate,
  Link: ({ children, to, search: params, ...props }: { children: React.ReactNode; to: string; search?: { id?: string } }) => <a href={to + (params?.id ? '?id=' + params.id : '')} {...props}>{children}</a>,
}))
vi.mock('@/api/client', () => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/features/notifications/components/NotificationContent', () => ({ default: () => <p>Exact interaction</p> }))

const entry: InteractionNotification = {
  id: 'event', domain: 'review', event: 'reply', targetId: 'review', commentId: 'reply',
  actor: { id: 'actor', name: 'Reader', avatarKey: null }, preview: 'Visible reply',
  createdAt: Date.now(), readAt: null,
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(async () => {
  vi.clearAllMocks()
  search = { page: 1 }
  await i18n.changeLanguage('zh-CN')
  useAuthStore.setState({ user: { id: 'recipient', username: 'Recipient', role: 'member', createdAt: 1, avatarKey: null } })
})

describe('notification center', () => {
  it('shares unread state with the global entry and refreshes it after a read write', async () => {
    let read = false
    vi.mocked(api.apiGet).mockImplementation(async (path) => path === '/notifications/unread'
      ? { data: { count: read ? 0 : 1 } }
      : { data: { entries: [{ ...entry, readAt: read ? 1 : null }], page: 1, hasMore: false } })
    vi.mocked(api.apiPut).mockImplementation(async () => { read = true; return { data: null } })
    render(<><NotificationBell /><NotificationCenter /></>, { wrapper: wrapper() })
    expect(await screen.findByText('Visible reply')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
    await waitFor(() => expect(screen.queryByTestId('notification-unread-dot')).not.toBeInTheDocument())
    expect(api.apiPut).toHaveBeenCalledWith('/notifications/event/read', { read: true })
    expect(screen.getByRole('link', { name: /Reader/ })).toHaveAttribute('href', '/notifications?id=event')
  })

  it('shows only an unavailable state for stale or inaccessible target links', async () => {
    search = { page: 1, id: 'hidden' }
    vi.mocked(api.apiGet).mockImplementation(async (path) => path.endsWith('/target')
      ? { data: { available: false } }
      : path.endsWith('/unread') ? { data: { count: 0 } } : { data: { entries: [], page: 1, hasMore: false } })
    render(<NotificationCenter />, { wrapper: wrapper() })
    expect(await screen.findByText(/这条互动已不可用/)).toBeInTheDocument()
    expect(screen.queryByText('Exact interaction')).not.toBeInTheDocument()
    expect(api.apiPut).not.toHaveBeenCalled()
  })

  it.each(['idea', 'review'])('reuses request IDs for failed %s comment retries and starts a new ID after success', async (domain) => {
    vi.mocked(api.apiPost).mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ data: { id: 'comment' } })
    const { result } = renderHook(() => domain === 'idea' ? useIdeaAction('target', 'book') : useReviewAction('target'), { wrapper: wrapper() })
    await act(async () => { await result.current.mutateAsync({ type: 'comment', body: 'draft' }).catch(() => undefined) })
    await act(async () => { await result.current.mutateAsync({ type: 'comment', body: 'draft' }) })
    const first = vi.mocked(api.apiPost).mock.calls[0][1]
    expect(vi.mocked(api.apiPost).mock.calls[1][1]).toEqual(first)
    expect(first).toMatchObject({ requestId: expect.stringMatching(/^[a-f0-9]{32}$/) })
    await act(async () => { await result.current.mutateAsync({ type: 'comment', body: 'draft' }) })
    expect(vi.mocked(api.apiPost).mock.calls[2][1]).not.toEqual(first)
  })
})
