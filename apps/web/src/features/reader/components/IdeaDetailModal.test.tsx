import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AnnotationRes } from '@bookdock/shared'

import IdeaDetailModal from './IdeaDetailModal'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('./IdeaDiscussionPanel', () => ({ default: () => <div>Retained discussion</div> }))
vi.mock('../hooks/useIdeas', () => ({
  useIdeaAction: () => ({ mutate: vi.fn() }),
  useIdeaDiscussion: () => ({ data: { data: { idea: {
    annotation: { id: 'idea', bookId: 'book', type: 'note', text: 'Retained quotation', note: 'Retained idea', cfiRange: 'cfi', createdAt: 1, updatedAt: 1 } as AnnotationRes,
    author: { id: 'author', name: 'Writer', avatarKey: null }, own: true, canDelete: true,
    liked: false, likeCount: 0, commentCount: 0, locationAvailable: true,
  } } }, isPending: false, isError: false }),
}))

describe('retained idea detail', () => {
  it.each([true, false])('keeps the detail readable and gates the original quotation on source availability: %s', (sourceAvailable) => {
    render(<QueryClientProvider client={new QueryClient()}><IdeaDetailModal ideaId="idea" bookVersionId="book" title="Book" theme="app" sourceAvailable={sourceAvailable} onClose={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('Retained idea')).toBeInTheDocument()
    expect(screen.getByText('Retained quotation')).toBeInTheDocument()
    expect(screen.getByText('Retained discussion')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'annotation.jumpToSource' }) !== null).toBe(sourceAvailable)
  })
})
