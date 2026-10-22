import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnnotationRes } from '@bookdock/shared'

import IdeaDetailModal from './IdeaDetailModal'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), locationAvailable: true }))
vi.mock('@tanstack/react-router', async () => ({
  ...(await import('@/__tests__/mocks/router-link')),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('./IdeaDiscussionPanel', () => ({ default: () => <div>Retained discussion</div> }))
vi.mock('../hooks/useIdeas', () => ({
  useIdeaAction: () => ({ mutate: vi.fn() }),
  useIdeaDiscussion: () => ({ data: { data: { idea: {
    annotation: { id: 'idea', bookId: 'book', type: 'note', text: 'Retained quotation', note: 'Retained idea', cfiRange: 'cfi', createdAt: 1, updatedAt: 1 } as AnnotationRes,
    author: { id: 'author', name: 'Writer', avatarKey: null }, own: true, canDelete: true,
    liked: false, likeCount: 0, commentCount: 0, locationAvailable: mocks.locationAvailable,
  } } }, isPending: false, isError: false }),
}))

describe('retained idea detail', () => {
  beforeEach(() => {
    mocks.locationAvailable = true
  })

  it('returns an activity idea jump to the same profile filter and history entry', () => {
    const readerReturn = { to: '/profile' as const, sourceHistoryIndex: 3, search: { userId: 'reader-1', activity: 'idea' as const } }
    mocks.navigate.mockReset()
    render(<QueryClientProvider client={new QueryClient()}><IdeaDetailModal ideaId="idea" bookVersionId="book" title="Book" theme="app" readerReturn={readerReturn} onClose={vi.fn()} /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'annotation.jumpToSource' }))

    const [navigation] = mocks.navigate.mock.calls[0] as [{ state: (previous: object) => object; search: { annotation: string }; params: { id: string } }]
    expect(navigation.params).toEqual({ id: 'book' })
    expect(navigation.search).toEqual({ annotation: 'idea' })
    expect(navigation.state({})).toEqual({ readerReturn })
  })

  it.each([true, false])('keeps the detail readable and gates the original quotation on source availability: %s', (sourceAvailable) => {
    render(<QueryClientProvider client={new QueryClient()}><IdeaDetailModal ideaId="idea" bookVersionId="book" title="Book" theme="app" sourceAvailable={sourceAvailable} onClose={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText('Retained idea')).toBeInTheDocument()
    expect(screen.getByText('Retained quotation')).toBeInTheDocument()
    expect(screen.getByText('Retained discussion')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'annotation.jumpToSource' }) !== null).toBe(sourceAvailable)
  })

  it('keeps retained detail readable but blocks a jump when the current source is not readable', () => {
    mocks.locationAvailable = false
    render(<QueryClientProvider client={new QueryClient()}><IdeaDetailModal ideaId="idea" bookVersionId="book" title="Book" theme="app" onClose={vi.fn()} /></QueryClientProvider>)

    expect(screen.getByText('Retained idea')).toBeInTheDocument()
    expect(screen.getByText('Retained quotation')).toBeInTheDocument()
    expect(screen.getByText('Retained discussion')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'annotation.jumpToSource' })).not.toBeInTheDocument()
  })
})
