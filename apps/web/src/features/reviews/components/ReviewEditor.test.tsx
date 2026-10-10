import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Review, ReviewComposerContext } from '@bookdock/shared'

const mutateAsync = vi.fn()

vi.mock('../hooks/useReviews', () => ({
  useSaveReview: () => ({ mutateAsync, isPending: false }),
}))

import ReviewEditor from './ReviewEditor'

const composer: ReviewComposerContext = {
  anchor: 'source',
  eligible: true,
  sourceReadable: false,
  canPublishShared: false,
  defaultVisibility: 'private',
  existing: null,
  bookVersionId: 'v1',
}

function sharedReview(): Review {
  return {
    id: 'r1',
    rating: 4,
    body: 'kept',
    bodyFormat: 'markdown',
    visibility: 'shared',
    source: { libraryId: 'source', libraryBookId: 'w1', libraryName: null },
    privateLibraryBookId: null,
    provenance: { listingId: 'l1', bookVersionId: 'v1', revisionId: null, versionName: null, available: false },
    author: { id: 'author', name: 'author', avatarKey: null },
    own: true,
    canDelete: true,
    likeCount: 0,
    liked: false,
    commentCount: 0,
    createdAt: 1,
    updatedAt: 1,
    editedAt: null,
  }
}

describe('ReviewEditor visibility retention', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    mutateAsync.mockResolvedValue({ data: null })
  })

  it('omits visibility on untouched edits so stranded shared reviews stay shared', async () => {
    render(<ReviewEditor bookVersionId="v1" existing={sharedReview()} composer={composer} onClose={() => {}} />)
    fireEvent.click(screen.getByText('library.save'))
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith({
      bookVersionId: 'v1',
      reviewId: 'r1',
      rating: 4,
      body: 'kept',
      visibility: undefined,
    })
  })

  it('sends an explicit private choice when the user picks it', async () => {
    render(<ReviewEditor bookVersionId="v1" existing={sharedReview()} composer={composer} onClose={() => {}} />)
    fireEvent.click(screen.getByText('review.visibilityPrivate'))
    fireEvent.click(screen.getByText('library.save'))
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'r1', visibility: 'private' }),
    )
  })

  it('inserts links through the modal dialog instead of a native prompt', async () => {
    render(<ReviewEditor bookVersionId="v1" existing={null} composer={{ ...composer, canPublishShared: true }} onClose={() => {}} />)
    expect(screen.queryByLabelText('review.linkUrlLabel')).toBeNull()
    fireEvent.click(screen.getByLabelText('review.formatLink'))
    const input = screen.getByLabelText('review.linkUrlLabel') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByText('review.linkConfirm'))
    await vi.waitFor(() => {
      const textarea = document.querySelector('textarea')
      expect(textarea?.value).toContain('(https://example.com)')
    })
  })

  it('disables format tools while previewing', () => {
    render(<ReviewEditor bookVersionId="v1" existing={null} composer={{ ...composer, canPublishShared: true }} onClose={() => {}} />)
    const bold = screen.getByLabelText('review.formatBold') as HTMLButtonElement
    expect(bold.disabled).toBe(false)
    fireEvent.click(screen.getByText('review.preview'))
    expect((screen.getByLabelText('review.formatBold') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('review.formatLink') as HTMLButtonElement).disabled).toBe(true)
  })
})
