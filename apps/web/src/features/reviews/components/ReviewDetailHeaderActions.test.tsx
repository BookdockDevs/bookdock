import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'

import type { Review } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'

import ReviewDetailHeaderActions from './ReviewDetailHeaderActions'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const baseReview: Review = {
  id: 'r1',
  rating: 4.0,
  title: null,
  body: 'shared body',
  bodyFormat: 'markdown',
  visibility: 'shared',
  source: null,
  privateLibraryBookId: null,
  provenance: null,
  author: { id: 'u2', name: 'qa-reader', avatarKey: null },
  own: false,
  canDelete: true,
  likeCount: 3,
  liked: false,
  commentCount: 1,
  createdAt: 1000,
  updatedAt: 1000,
  editedAt: null,
}

it('renders a countless like button and delete without touching the body', () => {
  const onDeleted = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={baseReview} onDeleted={onDeleted} />
    </QueryClientProvider>,
  )
  expect(screen.getByTitle('comment.like')).toBeTruthy()
  // No numeric count next to the like icon
  expect(screen.queryByText('3')).toBeNull()
  expect(screen.getByTitle('comment.delete')).toBeTruthy()
})

it('hides delete when the viewer cannot delete', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={{ ...baseReview, canDelete: false }} />
    </QueryClientProvider>,
  )
  expect(screen.getByTitle('comment.like')).toBeTruthy()
  expect(screen.queryByTitle('comment.delete')).toBeNull()
})

it('shows edit only for the author with an edit handler', () => {
  const onEdit = vi.fn()
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={{ ...baseReview, own: false }} onEdit={onEdit} />
    </QueryClientProvider>,
  )
  expect(screen.queryByTitle('comment.edit')).toBeNull()
  rerender(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={{ ...baseReview, own: true }} onEdit={onEdit} />
    </QueryClientProvider>,
  )
  const edit = screen.getByTitle('comment.edit')
  fireEvent.click(edit)
  expect(onEdit).toHaveBeenCalledWith({ ...baseReview, own: true })
})

it('shows like for private own reviews too', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={{ ...baseReview, visibility: 'private', own: true }} />
    </QueryClientProvider>,
  )
  expect(screen.getByTitle('comment.like')).toBeTruthy()
})

it('asks for confirmation before deleting', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailHeaderActions review={baseReview} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByTitle('comment.delete'))
  expect(screen.getByRole('alertdialog')).toBeTruthy()
})
