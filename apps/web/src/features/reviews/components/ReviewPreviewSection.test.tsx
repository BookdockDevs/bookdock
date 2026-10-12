import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { Review, ReviewBookContext } from '@bookdock/shared'

import ReviewPreviewSection from './ReviewPreviewSection'
import { hasReviewBody, pickFeaturedReview, scoreReview } from '../lib/review-select'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) => {
    if (params && 'count' in params) return `${key}:${params.count}`
    return key
  },
}))

const mockReview: Review = {
  id: 'r1',
  rating: 4.0,
  title: null,
  body: '书库可见书评。可展开讨论并验证互动。',
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
  author: { id: 'u1', name: 'qa-reader', avatarKey: null },
  own: false,
  canDelete: false,
  likeCount: 0,
  liked: false,
  commentCount: 1,
  createdAt: 1000,
  updatedAt: 1000,
  editedAt: null,
}

it('does not render when context is null or has zero reviews and zero summary count', () => {
  const { container, rerender } = render(
    <ReviewPreviewSection context={null} onViewAll={() => {}} />,
  )
  expect(container.firstChild).toBeNull()

  const emptyContext: ReviewBookContext = {
    composer: {
      anchor: null,
      eligible: false,
      sourceReadable: false,
      canPublishShared: false,
      defaultVisibility: 'shared',
      existing: null,
      bookVersionId: null,
    },
    own: null,
    summary: null,
    reviews: [],
  }
  rerender(<ReviewPreviewSection context={emptyContext} onViewAll={() => {}} />)
  expect(container.firstChild).toBeNull()
})

const mockReview2: Review = {
  ...mockReview,
  id: 'r2',
  rating: 5.0,
  title: null,
  body: '第二篇书评正文。',
  author: { id: 'u2', name: 'qa-owner', avatarKey: null },
  own: true,
  canDelete: true,
  likeCount: 0,
  liked: false,
  commentCount: 0,
  createdAt: 2000,
  updatedAt: 2000,
}

it('renders the preview section with count capsule and view-all entry, entry opens detail', () => {
  const onViewAll = vi.fn()
  const onOpenReview = vi.fn()
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
    summary: {
      average: 4.0,
      count: 12,
      distribution: [],
    },
    reviews: [mockReview, mockReview2],
  }

  render(<ReviewPreviewSection context={context} onViewAll={onViewAll} onOpenReview={onOpenReview} />)

  // Title
  expect(screen.getByText('review.reviewsTitle')).toBeTruthy()
  // Count capsule next to the title counts visible rows
  expect(screen.getByText('2')).toBeTruthy()
  // "查看全部" without count
  expect(screen.getByText('review.viewAll')).toBeTruthy()
  // Newest body review is featured
  expect(screen.getByText('qa-owner')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'review.ratingValue' })).toBeTruthy()
  expect(screen.getByText('第二篇书评正文。')).toBeTruthy()

  // Clicking view-all button opens the list
  fireEvent.click(screen.getByText('review.viewAll'))
  expect(onViewAll).toHaveBeenCalledTimes(1)
  expect(onOpenReview).not.toHaveBeenCalled()

  // Clicking the preview card opens the detail
  fireEvent.click(screen.getByText('qa-owner'))
  expect(onOpenReview).toHaveBeenCalledTimes(1)
  expect(onOpenReview).toHaveBeenCalledWith(mockReview2)
  expect(onViewAll).toHaveBeenCalledTimes(1)
})

it('keeps other visible reviews reachable after own review goes private', () => {
  const onViewAll = vi.fn()
  const ownPrivate: Review = {
    ...mockReview2,
    visibility: 'private',
    updatedAt: 3000,
    createdAt: 3000,
  }
  const context: ReviewBookContext = {
    composer: {
      anchor: 'source',
      eligible: true,
      sourceReadable: true,
      canPublishShared: true,
      defaultVisibility: 'shared',
      existing: ownPrivate,
      bookVersionId: 'v1',
    },
    own: ownPrivate,
    summary: {
      average: 4.0,
      count: 1,
      distribution: [],
    },
    reviews: [mockReview],
  }

  render(<ReviewPreviewSection context={context} onViewAll={onViewAll} onOpenReview={() => {}} />)

  // Two visible rows: the list entry stays even though shared stats say 1
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByText('review.viewAll')).toBeTruthy()
  // Newest body (own private) is featured with its badges
  expect(screen.getByText('review.ownBadge')).toBeTruthy()
  expect(screen.getByText('review.visibilityPrivate')).toBeTruthy()
})

it('hides the capsule and view-all entry for a single review', () => {
  const onViewAll = vi.fn()
  const onOpenReview = vi.fn()
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
    summary: {
      average: 4.0,
      count: 1,
      distribution: [],
    },
    reviews: [mockReview],
  }

  render(<ReviewPreviewSection context={context} onViewAll={onViewAll} onOpenReview={onOpenReview} />)

  expect(screen.getByText('review.reviewsTitle')).toBeTruthy()
  expect(screen.queryByText('review.viewAll')).toBeNull()
  expect(screen.getByText('qa-reader')).toBeTruthy()

  fireEvent.click(screen.getByText('qa-reader'))
  expect(onOpenReview).toHaveBeenCalledTimes(1)
  expect(onViewAll).not.toHaveBeenCalled()
})

const DAY = 86400000
const NOW = 1792000000000

function selectionReview(partial: Partial<Review> & { id: string }): Review {
  return {
    rating: null,
    title: null,
    body: null,
    bodyFormat: 'markdown',
    visibility: 'shared',
    source: null,
    privateLibraryBookId: null,
    provenance: null,
    author: { id: 'u', name: 'reader', avatarKey: null },
    own: false,
    canDelete: false,
    likeCount: 0,
    liked: false,
    commentCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    editedAt: null,
    ...partial,
  }
}

it('treats whitespace-only and markup-only bodies as rating-only, files as body', () => {
  expect(hasReviewBody(selectionReview({ id: 'a', body: '  \n  ' }))).toBe(false)
  expect(hasReviewBody(selectionReview({ id: 'b', body: '** **' }))).toBe(false)
  expect(hasReviewBody(selectionReview({ id: 'c', body: null }))).toBe(false)
  expect(hasReviewBody(selectionReview({ id: 't', body: '| a | b |\n|---|---|\n| 1 | 2 |' }))).toBe(false)
  expect(hasReviewBody(selectionReview({ id: 'd', body: 'real text' }))).toBe(true)
  expect(hasReviewBody(selectionReview({
    id: 'e',
    body: null,
    files: [{ id: 'cfile_abcdefghijklmnopqrstu', kind: 'image', name: 'x.png', mimeType: 'image/png', size: 1, url: '/x' }],
  }))).toBe(true)
})

it('picks a body review over a newer rating-only one in small sets', () => {
  const rated = selectionReview({ id: 'rated', rating: 5, createdAt: NOW })
  const bodied = selectionReview({ id: 'bodied', body: 'words', createdAt: NOW - 10 * DAY })
  expect(pickFeaturedReview([rated, bodied], NOW)?.id).toBe('bodied')
  expect(pickFeaturedReview([rated], NOW)?.id).toBe('rated')
})

it('prefers the newest within one class for 2-5 reviews', () => {
  const oldBody = selectionReview({ id: 'old', body: 'old words', createdAt: NOW - 5 * DAY })
  const newBody = selectionReview({ id: 'new', body: 'new words', createdAt: NOW - DAY })
  expect(pickFeaturedReview([oldBody, newBody], NOW)?.id).toBe('new')
})

it('uses the hot score for 6+ reviews regardless of age', () => {
  const oldHot = selectionReview({ id: 'old-hot', body: 'old words', createdAt: NOW - 100 * DAY, likeCount: 10 })
  const fresh = selectionReview({ id: 'fresh', body: 'new words', createdAt: NOW - DAY, likeCount: 1 })
  const fillers = [1, 2, 3, 4].map((n) => selectionReview({ id: `filler-${n}`, body: `filler ${n}`, createdAt: NOW - n * DAY }))
  expect(scoreReview(oldHot, NOW)).toBeGreaterThan(scoreReview(fresh, NOW))
  expect(pickFeaturedReview([fresh, oldHot, ...fillers], NOW)?.id).toBe('old-hot')
})

it('breaks score ties by stable id', () => {
  const a = selectionReview({ id: 'a-same', body: 'x', createdAt: NOW - 2 * DAY })
  const b = selectionReview({ id: 'b-same', body: 'x', createdAt: NOW - 2 * DAY })
  const fillers = [1, 2, 3, 4].map((n) => selectionReview({ id: `g-${n}`, body: `g ${n}`, createdAt: NOW - 10 * DAY }))
  expect(pickFeaturedReview([b, a, ...fillers], NOW)?.id).toBe('a-same')
})

it('renders rating-only picks compactly with time and stars but no counts', () => {
  const ratedOnly = selectionReview({ id: 'rated-only', rating: 4.5, likeCount: 5, commentCount: 3, createdAt: NOW - DAY })
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
    reviews: [ratedOnly],
  }
  render(<ReviewPreviewSection context={context} onViewAll={() => {}} />)
  expect(screen.getByRole('img')).toBeTruthy()
  expect(screen.queryByText('5')).toBeNull()
  expect(screen.queryByText('3')).toBeNull()
})
