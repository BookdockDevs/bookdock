import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InteractionNotification } from '@bookdock/shared'
import { useRef, useState, type RefObject } from 'react'

import * as api from '@/api/client'
import NotificationCenter from '@/features/notifications/NotificationCenter'
import NotificationBell from '@/features/notifications/components/NotificationBell'
import NotificationDrawer from '@/features/notifications/components/NotificationDrawer'
import { useReviewAction } from '@/features/reviews/hooks/useReviews'
import { useIdeaAction } from '@/features/reader/hooks/useIdeas'
import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'

let search: { page: number; id?: string } = { page: 1 }
const navigate = vi.fn()
vi.mock('@tanstack/react-router', async () => ({
  ...await import('@/__tests__/mocks/router-link'),
  useSearch: () => search, useNavigate: () => navigate,
}))
vi.mock('@/api/client', () => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/features/reader/components/IdeaDetailModal', () => ({ default: () => <p>Exact interaction</p> }))
vi.mock('@/features/reviews/components/ReviewCard', () => ({ default: () => <p>Exact interaction</p> }))

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
  it('keeps the bell highlighted only while its popover is open across dismissal paths', async () => {
    vi.mocked(api.apiGet).mockImplementation(async (path) => path.endsWith('/unread')
      ? { data: { count: 0 } }
      : { data: { entries: [], page: 1, hasMore: false } })
    function Notifications() {
      const [open, setOpen] = useState(false)
      const anchorRef = useRef<HTMLButtonElement>(null)
      return <>
        <NotificationBell buttonRef={anchorRef} open={open} onOpen={() => setOpen((value) => !value)} />
        <NotificationDrawer anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} />
      </>
    }
    render(<Notifications />, { wrapper: wrapper() })
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell).toHaveAttribute('aria-expanded', 'false')

    for (const dismissal of ['toggle', 'escape', 'close', 'outside']) {
      fireEvent.click(bell)
      expect(await screen.findByRole('dialog', { name: '通知' })).toBeInTheDocument()
      expect(bell).toHaveAttribute('aria-expanded', 'true')
      expect(bell).toHaveClass('bg-stone-200/60', 'text-stone-900')
      if (dismissal === 'toggle') fireEvent.click(bell)
      else if (dismissal === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
      else if (dismissal === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))
      else fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('dialog', { name: '通知' })).not.toBeInTheDocument()
      expect(bell).toHaveAttribute('aria-expanded', 'false')
      expect(bell).not.toHaveClass('bg-stone-200/60')
    }
  })

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
    const actorLinks = screen.getAllByRole('link', { name: 'Reader' })
    expect(actorLinks).toHaveLength(2)
    for (const link of actorLinks) expect(link).toHaveAttribute('href', '/profile?userId=actor')
    expect(screen.getByRole('link', { name: /Visible reply/ })).toHaveAttribute('href', '/notifications?page=1&id=event')
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

  it('resets the open detail when the drawer closes and reopens', async () => {
    vi.mocked(api.apiGet).mockImplementation(async (path: string) => {
      if (path.endsWith('/target')) return { data: { available: true, notification: entry } }
      if (path.endsWith('/unread')) return { data: { count: 1 } }
      return { data: { entries: [entry], page: 1, hasMore: false } }
    })
    vi.mocked(api.apiPut).mockResolvedValue({ data: null })
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    const anchorRef = { current: anchor } as RefObject<HTMLButtonElement | null>
    try {
      const onClose = vi.fn()
      const { rerender } = render(<NotificationDrawer anchorRef={anchorRef} open={true} onClose={onClose} />, { wrapper: wrapper() })
      fireEvent.click(await screen.findByRole('button', { name: /Reader/ }))
      expect(await screen.findByText('Exact interaction')).toBeInTheDocument()
      rerender(<NotificationDrawer anchorRef={anchorRef} open={false} onClose={onClose} />)
      await waitFor(() => expect(screen.queryByText('Exact interaction')).not.toBeInTheDocument())
      rerender(<NotificationDrawer anchorRef={anchorRef} open={true} onClose={onClose} />)
      await screen.findByRole('button', { name: /Reader/ })
      expect(screen.queryByText('Exact interaction')).not.toBeInTheDocument()
    } finally {
      anchor.remove()
    }
  })

  it('distinguishes content likes from comment likes in the first row', async () => {
    const base = { ...entry, readAt: 1 }
    const contentLike: InteractionNotification = { ...base, id: 'like-content', domain: 'idea', event: 'like', targetId: 'idea', commentId: null, preview: 'Idea summary' }
    const commentLike: InteractionNotification = { ...base, id: 'like-comment', domain: 'review', event: 'like', targetId: 'review', commentId: 'comment', preview: 'Liked comment body' }
    vi.mocked(api.apiGet).mockImplementation(async (path) => path.endsWith('/unread')
      ? { data: { count: 0 } }
      : { data: { entries: [contentLike, commentLike], page: 1, hasMore: false } })
    render(<NotificationCenter />, { wrapper: wrapper() })
    expect(await screen.findByText(/赞了你的想法/)).toBeInTheDocument()
    expect(screen.getByText(/赞了你在书评下的评论/)).toBeInTheDocument()
    expect(screen.queryByText(/赞了你的内容/)).not.toBeInTheDocument()
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
