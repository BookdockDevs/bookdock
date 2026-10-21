import { render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'

import type { Review } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'

import ReviewDetailView from './ReviewDetailView'

vi.mock('@tanstack/react-router', () => import('@/__tests__/mocks/router-link'))

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('./ReviewDiscussionPanel', () => ({ default: () => null }))

const sharedReview: Review = {
  id: 'r1',
  rating: 4.0,
  title: 'Titled',
  body: 'shared body',
  bodyFormat: 'markdown',
  visibility: 'shared',
  source: null,
  privateLibraryBookId: null,
  provenance: null,
  author: { id: 'u2', name: 'qa-reader', avatarKey: null },
  own: false,
  canDelete: false,
  likeCount: 3,
  liked: false,
  commentCount: 1,
  createdAt: 1000,
  updatedAt: 1000,
  editedAt: null,
}

it('shows five stars without like or delete controls in the body', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailView review={sharedReview} />
    </QueryClientProvider>,
  )
  // Five-star display, not the numeric "4.0"
  expect(screen.getByRole('img', { name: 'review.ratingValue' })).toBeTruthy()
  expect(screen.queryByText('4.0')).toBeNull()
  // Like and delete live in the modal top bar, not here
  expect(screen.queryByTitle('comment.like')).toBeNull()
  expect(screen.queryByTitle('comment.delete')).toBeNull()
})

it('shows createdAt with an edited badge only after real content edits', () => {
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDetailView review={{ ...sharedReview, updatedAt: 3000, editedAt: 2000 }} />
    </QueryClientProvider>,
  )
  expect(screen.getByText('review.edited')).toBeTruthy()
  expect(screen.getByTitle('review.publishedTimeTitle')).toBeTruthy()
  expect(screen.getByTitle('review.editedTimeTitle')).toBeTruthy()
})
