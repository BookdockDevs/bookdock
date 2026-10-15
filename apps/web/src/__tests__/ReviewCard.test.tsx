import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { Review } from '@bookdock/shared'

import ReviewCard from '@/features/reviews/components/ReviewCard'

// Capture the router destination instead of mounting a router: the author
// name must stay an in-app SPA navigation (Link) so the reader history index
// survives the jump to the public profile.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode
    to?: string
    search?: unknown
  }) => (
    <a href={to} data-to={to} data-search={search ? JSON.stringify(search) : undefined}>
      {children}
    </a>
  ),
}))

vi.mock('@/features/reviews/hooks/useReviews', () => ({
  useDeleteReview: () => ({ mutateAsync: vi.fn() }),
  useReviewAction: () => ({ mutate: vi.fn(), isPending: false }),
}))

const REVIEW: Review = {
  id: 'r1',
  rating: 5,
  title: 'Good',
  body: 'short body',
  bodyFormat: 'plain',
  visibility: 'shared',
  source: null,
  privateLibraryBookId: null,
  provenance: null,
  author: { id: 'author-1', name: 'Author One', avatarKey: null },
  own: false,
  canDelete: false,
  likeCount: 0,
  liked: false,
  commentCount: 0,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  editedAt: null,
}

describe('ReviewCard author link', () => {
  it('navigates to the public profile as an in-app route with the author id', () => {
    render(<ReviewCard review={REVIEW} />)
    const link = screen.getByText('Author One').closest('a')!
    expect(link.getAttribute('data-to')).toBe('/profile')
    expect(JSON.parse(link.getAttribute('data-search')!)).toMatchObject({ userId: 'author-1' })
  })
})
