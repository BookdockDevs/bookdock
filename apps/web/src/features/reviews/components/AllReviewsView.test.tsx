import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'

import type { Review, ReviewBookContext } from '@bookdock/shared'

import { queryClient } from '@/lib/query-client'

import AllReviewsView from './AllReviewsView'

import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => {
    if (params && 'count' in params) return `${key}:${params.count}`
    return key
  },
}))

const ownReview: Review = {
  id: 'r-own',
  rating: 4.5,
  title: '桌面编辑验证',
  body: '这篇书评包含 Markdown、表格、代码块。',
  bodyFormat: 'markdown',
  visibility: 'private',
  source: null,
  privateLibraryBookId: 'b1',
  provenance: null,
  author: { id: 'u1', name: 'qa-owner', avatarKey: null },
  own: true,
  canDelete: true,
  likeCount: 0,
  liked: false,
  commentCount: 0,
  createdAt: 2000,
  updatedAt: 2000,
  editedAt: null,
}

const sharedReview: Review = {
  id: 'r-shared',
  rating: 4.0,
  title: null,
  body: '书库可见书评。可展开讨论。',
  bodyFormat: 'plain',
  visibility: 'shared',
  source: null,
  privateLibraryBookId: null,
  provenance: {
    listingId: null,
    bookVersionId: 'v1',
    revisionId: null,
    versionName: '某一版本',
    available: true,
  },
  author: { id: 'u2', name: 'qa-reader', avatarKey: null },
  own: false,
  canDelete: false,
  likeCount: 2,
  liked: false,
  commentCount: 1,
  createdAt: 1000,
  updatedAt: 1000,
  editedAt: null,
}

it('renders AllReviewsView with header, count, filter tabs, and items', () => {
  useAuthStore.setState({ user: { id: 'u1', username: 'qa-owner', role: 'owner' } })
  const onOpenCompose = vi.fn()
  const onOpenEdit = vi.fn()
  const onOpenReviewDetail = vi.fn()

  const context: ReviewBookContext = {
    composer: {
      anchor: 'source',
      eligible: true,
      sourceReadable: true,
      canPublishShared: true,
      defaultVisibility: 'shared',
      existing: ownReview,
      bookVersionId: 'v1',
    },
    own: ownReview,
    summary: {
      average: 4.0,
      count: 2,
      distribution: [],
    },
    reviews: [sharedReview],
  }

  render(
    <QueryClientProvider client={queryClient}>
      <AllReviewsView
        context={context}
        canReview={true}
        onOpenCompose={onOpenCompose}
        onOpenEdit={onOpenEdit}
        onOpenReviewDetail={onOpenReviewDetail}
      />
    </QueryClientProvider>,
  )

  // No book title / count header; write entry lives on the tabs row
  expect(screen.queryByText('验收样本')).toBeNull()
  expect(screen.getByText('review.editReview')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: 'review.sortNewest' })).toBeTruthy()

  // Filter tabs are 全部/我的 only
  expect(screen.getByText('review.filterAll')).toBeTruthy()
  expect(screen.getByText('review.filterMine')).toBeTruthy()
  expect(screen.queryByText('review.filterLibrary')).toBeNull()

  // Both reviews rendered in 'all' tab
  expect(screen.getByText('qa-owner')).toBeTruthy()
  expect(screen.getByText('桌面编辑验证')).toBeTruthy()
  expect(screen.getByText('qa-reader')).toBeTruthy()
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('qa-owner')

  fireEvent.click(screen.getByRole('button', { name: 'review.sortNewest' }))
  expect(screen.getByRole('menu')).toBeTruthy()
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'review.sortOldest' }))
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('qa-reader')

  // Ratings render as five-star displays, not numbers
  expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2)

  // Clicking "我的" tab filters to only own review
  fireEvent.click(screen.getByText('review.filterMine'))
  expect(screen.getByText('qa-owner')).toBeTruthy()
  expect(screen.queryByText('qa-reader')).toBeNull()

  // Clicking a card opens its detail (back to 全部 first)
  fireEvent.click(screen.getByText('review.filterAll'))
  fireEvent.click(screen.getByText('书库可见书评。可展开讨论。'))
  expect(onOpenReviewDetail).toHaveBeenCalledWith(sharedReview)
})

it('shows createdAt with an edited badge and full-datetime titles', () => {
  useAuthStore.setState({ user: { id: 'u1', username: 'qa-owner', role: 'owner' } })
  const editedReview: Review = {
    ...sharedReview,
    id: 'r-edited',
    createdAt: 1000,
    updatedAt: 3000,
    editedAt: 2000,
  }
  const context: ReviewBookContext = {
    composer: {
      anchor: 'source',
      eligible: true,
      sourceReadable: true,
      canPublishShared: true,
      defaultVisibility: 'shared',
      existing: null,
      bookVersionId: 'v1',
    },
    own: null,
    summary: null,
    reviews: [editedReview],
  }
  render(
    <QueryClientProvider client={queryClient}>
      <AllReviewsView
        context={context}
        canReview={false}
        onOpenCompose={() => {}}
        onOpenEdit={() => {}}
        onOpenReviewDetail={() => {}}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByText('review.edited')).toBeTruthy()
  expect(screen.getByTitle('review.publishedTimeTitle')).toBeTruthy()
  expect(screen.getByTitle('review.editedTimeTitle')).toBeTruthy()
})

it('hides the mine tab when the current user has no review', () => {
  useAuthStore.setState({ user: { id: 'u1', username: 'qa-owner', role: 'owner' } })
  const context: ReviewBookContext = {
    composer: {
      anchor: 'source',
      eligible: true,
      sourceReadable: true,
      canPublishShared: true,
      defaultVisibility: 'shared',
      existing: null,
      bookVersionId: 'v1',
    },
    own: null,
    summary: null,
    reviews: [sharedReview],
  }

  render(
    <QueryClientProvider client={queryClient}>
      <AllReviewsView
        context={context}
        canReview={false}
        onOpenCompose={() => {}}
        onOpenEdit={() => {}}
        onOpenReviewDetail={() => {}}
      />
    </QueryClientProvider>,
  )

  expect(screen.getByText('review.filterAll')).toBeTruthy()
  expect(screen.queryByText('review.filterMine')).toBeNull()
})
