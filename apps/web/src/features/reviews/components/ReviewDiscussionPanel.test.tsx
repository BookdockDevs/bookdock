import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ReviewDiscussion } from '@bookdock/shared'

import ReviewDiscussionPanel from './ReviewDiscussionPanel'

vi.mock('@tanstack/react-router', () => import('@/__tests__/mocks/router-link'))

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const discussion: ReviewDiscussion = {
  review: {
    id: 'r1',
    rating: null,
    title: null,
    body: 'body',
    bodyFormat: 'plain',
    visibility: 'shared',
    source: null,
    privateLibraryBookId: null,
    provenance: null,
    author: { id: 'u1', name: 'qa-reader', avatarKey: null },
    own: false,
    canDelete: false,
    likeCount: 0,
    liked: false,
    commentCount: 2,
    createdAt: 1000,
    updatedAt: 1000,
    editedAt: null,
  },
  comments: [
    {
      id: 'c1',
      parentId: null,
      replyToId: null,
      replyToName: null,
      author: { id: 'u2', name: 'member', avatarKey: null },
      body: 'first words',
      createdAt: 1000,
      editedAt: null,
      deletedAt: null,
      own: false,
      canDelete: false,
      liked: false,
      likeCount: 0,
    },
    {
      id: 'c2',
      parentId: null,
      replyToId: null,
      replyToName: null,
      author: { id: 'u2', name: 'member', avatarKey: null },
      body: 'revised words',
      createdAt: 1000,
      editedAt: 2000,
      deletedAt: null,
      own: false,
      canDelete: false,
      liked: false,
      likeCount: 0,
    },
  ],
  likers: [],
}

vi.mock('../hooks/useReviews', () => ({
  useReviewDiscussion: () => ({
    data: { data: discussion },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useReviewAction: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}))

it('shows createdAt times with an edited badge only on revised comments', () => {
  render(<ReviewDiscussionPanel reviewId="r1" reviewAuthorId="u1" />)
  expect(screen.getByText('first words')).toBeTruthy()
  expect(screen.getByText('revised words')).toBeTruthy()
  expect(screen.getAllByText('review.edited')).toHaveLength(1)
  expect(screen.getAllByTitle('review.publishedTimeTitle')).toHaveLength(2)
  expect(screen.getAllByTitle('review.editedTimeTitle')).toHaveLength(1)
})
