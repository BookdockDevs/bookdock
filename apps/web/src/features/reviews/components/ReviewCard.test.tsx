import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'

import type { Review } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'

import ReviewCard from './ReviewCard'

const state = vi.hoisted(() => ({ deleted: false }))
vi.mock('@/api/client', async (original) => ({ ...(await original<typeof import('@/api/client')>()), apiDelete: vi.fn(async () => { state.deleted = true }) }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('./ReviewDiscussionPanel', () => ({ default: () => null }))

function NotificationProjections() {
  const list = useQuery({ queryKey: ['notifications', 'list'], queryFn: async () => state.deleted ? [] : ['event'] })
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: async () => state.deleted ? 0 : 1 })
  const target = useQuery({ queryKey: ['notifications', 'target', 'event'], queryFn: async () => state.deleted ? 'unavailable' : 'available' })
  return <output>{JSON.stringify([list.data, unread.data, target.data])}</output>
}

afterEach(() => { queryClient.clear(); state.deleted = false })

it('refreshes notification list, unread count and open target immediately after deleting a card', async () => {
  const review: Review = { id: 'review', body: null, bodyFormat: 'plain', rating: 4, visibility: 'private', source: null, privateLibraryBookId: 'book', provenance: null, author: { id: 'author', name: 'author', avatarKey: null }, own: true, canDelete: true, liked: false, likeCount: 0, commentCount: 0, createdAt: 1, updatedAt: 1, editedAt: null }
  render(<QueryClientProvider client={queryClient}><NotificationProjections /><ReviewCard review={review} /></QueryClientProvider>)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('[["event"],1,"available"]'))
  fireEvent.click(screen.getByTitle('comment.delete'))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'comment.delete', exact: true }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('[[],0,"unavailable"]'))
})
