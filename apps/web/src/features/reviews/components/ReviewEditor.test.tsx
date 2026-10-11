import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Review, ReviewComposerContext } from '@bookdock/shared'

const mutateAsync = vi.fn()

vi.mock('../hooks/useReviews', () => ({
  useSaveReview: () => ({ mutateAsync, isPending: false }),
}))

vi.mock('@/features/content-files/hooks/useContentDraft', () => ({
  useContentDraft: () => ({ draftId: 'draft-editor-test', entries: [], add: vi.fn(), retry: vi.fn(), uploading: false }),
}))
vi.mock('./ReviewRichEditor', () => ({
  default: ({ body, onChange, onUnsupported }: { body: string; onChange: (body: string) => void; onUnsupported: () => void }) => (
    <><textarea aria-label="visual-body" value={body} onChange={(event) => onChange(event.target.value)} /><button onClick={onUnsupported}>unsupported</button></>
  ),
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
      bodyFormat: 'markdown',
      draftId: 'draft-editor-test',
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

  it('keeps legacy plain text unchanged until explicit conversion', async () => {
    render(<ReviewEditor bookVersionId="v1" existing={{ ...sharedReview(), body: '**literal**', bodyFormat: 'plain' }} composer={composer} onClose={() => {}} />)
    expect((screen.getByLabelText('review.bodyLabel') as HTMLTextAreaElement).value).toBe('**literal**')
    fireEvent.click(screen.getByText('library.save'))
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ body: '**literal**', bodyFormat: 'plain' })))
    fireEvent.click(screen.getByText('review.convertMarkdown'))
    await screen.findByLabelText('visual-body')
    expect((screen.getByLabelText('visual-body') as HTMLTextAreaElement).value).not.toBe('**literal**')
  })

  it('retains complete source after unsupported imports and save failure', async () => {
    const original = '# Heading\n\n<iframe src="blocked"></iframe>\n\nTail'
    const onClose = vi.fn()
    mutateAsync.mockRejectedValue(new Error('failed'))
    render(<ReviewEditor bookVersionId="v1" existing={{ ...sharedReview(), body: original }} composer={composer} onClose={onClose} />)
    expect((screen.getByLabelText('review.bodyLabel') as HTMLTextAreaElement).value).toBe(original)
    fireEvent.click(screen.getByText('library.save'))
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ body: original })))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('review.bodyLabel') as HTMLTextAreaElement).value).toBe(original)
  })

  it('keeps Markdown and plain preview interpretation consistent', async () => {
    render(<ReviewEditor bookVersionId="v1" existing={{ ...sharedReview(), body: '**literal**', bodyFormat: 'plain' }} composer={composer} onClose={() => {}} />)
    fireEvent.click(screen.getByText('review.preview'))
    expect(document.querySelector('.review-markdown')?.textContent).toBe('**literal**')
    expect(document.querySelector('.review-markdown strong')).toBeNull()
    fireEvent.click(screen.getByText('review.returnEdit'))
    expect((screen.getByLabelText('review.bodyLabel') as HTMLTextAreaElement).value).toBe('**literal**')
  })

})
