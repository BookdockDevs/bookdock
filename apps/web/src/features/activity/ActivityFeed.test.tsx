import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/i18n'

import ActivityFeed from './ActivityFeed'

const mocks = vi.hoisted(() => ({
  useActivity: vi.fn(),
  useActivityGroup: vi.fn(),
  refetchGroup: vi.fn(),
  fetchGroupNext: vi.fn(),
}))

vi.mock('./hooks', () => ({
  useActivity: mocks.useActivity,
  useActivityGroup: mocks.useActivityGroup,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/features/reader/components/IdeaDetailModal', () => ({ default: ({ ideaId, bookVersionId }: { ideaId: string; bookVersionId: string }) => <div role="dialog">idea:{ideaId}:{bookVersionId}</div> }))
vi.mock('./components/ReviewActivityModal', () => ({ default: ({ reviewId }: { reviewId: string }) => <div role="dialog">review:{reviewId}</div> }))

const idea = {
  kind: 'idea', eventId: 'event-1', eventType: 'idea.published', visibility: 'shared', occurredAt: 1_800_000_000_000,
  actor: { id: 'user-1', name: 'Reader', avatarKey: 'avatar-1' }, libraryId: 'library-1', operationId: null,
  target: { ideaId: 'idea-1', libraryBookVersionId: 'listing-1', bookVersionId: 'version-1', revisionId: null },
  content: { workTitle: 'A book', libraryName: 'Shared shelf', excerpt: 'A thought', chapter: null },
} as const

const privateIdea = {
  ...idea,
  eventId: 'private-idea-event',
  eventType: 'idea.recorded',
  visibility: 'private',
  libraryId: null,
  target: { ...idea.target, libraryBookVersionId: null, bookVersionId: null },
  content: { ...idea.content, workTitle: '', libraryName: null },
} as const

const privateReview = {
  kind: 'review', eventId: 'private-review-event', eventType: 'review.recorded', visibility: 'private', occurredAt: 1_800_000_000_000,
  actor: { id: 'user-1', name: 'Reader', avatarKey: 'avatar-1' }, libraryId: null, operationId: null,
  target: { reviewId: 'review-1', libraryBookId: null, bookVersionId: null },
  content: { workTitle: 'Private review book', libraryName: null, title: 'A private review', excerpt: 'Private review text', ratingHalves: 8 },
} as const

const group = {
  kind: 'catalog-group', eventId: 'group-1', eventType: 'work.added', occurredAt: 1_800_000_000_000,
  actor: { id: 'user-1', name: 'Reader', avatarKey: null }, libraryId: 'library-1', operationId: 'op-1', count: 2,
  preview: [{ workId: 'work-1', versionId: null, workTitle: 'A book', objectLabel: null, bookVersionId: null }],
} as const

function activityResult(items: unknown[], canManage = false) {
  return {
    data: { pages: [{ data: { items, nextCursor: 'next', canManage } }] },
    isPending: false, isError: false, isFetching: false, hasNextPage: true, isFetchingNextPage: false,
    refetch: vi.fn(), fetchNextPage: vi.fn(),
  }
}

describe('ActivityFeed', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mocks.useActivity.mockReset()
    mocks.useActivityGroup.mockReset()
    mocks.refetchGroup.mockReset()
    mocks.fetchGroupNext.mockReset()
    mocks.useActivity.mockReturnValue(activityResult([]))
    mocks.useActivityGroup.mockReturnValue({ data: undefined, isPending: false, isError: false, isFetching: false, hasNextPage: false, isFetchingNextPage: false, refetch: mocks.refetchGroup, fetchNextPage: mocks.fetchGroupNext })
  })

  it('only offers management filtering when the activity endpoint confirms manager access', () => {
    const view = render(<ActivityFeed scope="library" targetId="library-1" type="all" onFilterChange={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: i18n.t('activity.management') })).not.toBeInTheDocument()
    mocks.useActivity.mockReturnValue(activityResult([], true))
    view.rerender(<ActivityFeed scope="library" targetId="library-1" type="all" onFilterChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: i18n.t('activity.management') })).toBeInTheDocument()
  })

  it('opens an idea detail and requests the next activity page', () => {
    const result = activityResult([idea])
    mocks.useActivity.mockReturnValue(result)
    render(<ActivityFeed scope="personal" targetId="user-1" type="all" onFilterChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /A book/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('idea:idea-1:version-1')
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('activity.loadMore') })[0]!)
    expect(result.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('shows the source library link on personal activity but not library activity', () => {
    mocks.useActivity.mockReturnValue(activityResult([idea]))
    const view = render(<ActivityFeed scope="library" targetId="library-1" type="all" />)

    expect(screen.queryByRole('link', { name: 'Shared shelf' })).not.toBeInTheDocument()

    view.rerender(<ActivityFeed scope="personal" targetId="user-1" type="all" />)

    expect(screen.getByRole('link', { name: 'Shared shelf' })).toBeInTheDocument()
  })

  it('hides actor identity on personal activity while retaining it in library activity', () => {
    mocks.useActivity.mockReturnValue(activityResult([idea]))
    const view = render(<ActivityFeed scope="personal" targetId="user-1" type="all" />)
    const personalCard = screen.getByRole('article')

    expect(within(personalCard).queryByText('Reader')).not.toBeInTheDocument()
    expect(personalCard.querySelector('img')).not.toBeInTheDocument()
    expect(within(personalCard).getByText(i18n.t('activity.idea'))).toBeInTheDocument()
    expect(within(personalCard).getByText('A book')).toBeInTheDocument()
    expect(within(personalCard).getByRole('link', { name: 'Shared shelf' })).toBeInTheDocument()

    view.rerender(<ActivityFeed scope="library" targetId="library-1" type="all" />)
    const libraryCard = screen.getByRole('article')
    const actorLink = within(libraryCard).getByRole('link', { name: 'Reader' })
    expect(actorLink.querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/avatar-1')
  })

  it('shows private activity without extra badges for private libraries, and lock icon for shared libraries', () => {
    const sharedPrivateIdea = {
      ...privateIdea,
      eventId: 'shared-private-idea-event',
      libraryId: 'library-1',
      content: { ...privateIdea.content, libraryName: 'Shared shelf' },
    }
    mocks.useActivity.mockReturnValue(activityResult([privateIdea, privateReview, sharedPrivateIdea]))
    render(<ActivityFeed scope="personal" targetId="user-1" type="all" />)
    const cards = screen.getAllByRole('article')

    expect(screen.getByTitle(i18n.t('annotation.visibilityPrivate'))).toBeInTheDocument()
    expect(within(cards[0]!).getByText(i18n.t('activity.idea'))).toBeInTheDocument()
    expect(within(cards[1]!).getByText(i18n.t('activity.review'))).toBeInTheDocument()
    expect(cards.every((card) => !card.textContent?.includes('Reader') && !card.querySelector('img'))).toBe(true)
    expect(within(cards[0]!).getByText(i18n.t('archive.sourceUnavailable'))).toBeInTheDocument()

    const unavailableIdeaButton = within(cards[0]!).getByRole('button', { name: new RegExp(i18n.t('archive.sourceUnavailable')) })
    expect(unavailableIdeaButton).toBeDisabled()
    expect(within(cards[1]!).queryByText('Shared shelf')).not.toBeInTheDocument()

    fireEvent.click(within(cards[1]!).getByRole('button', { name: /Private review book/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('review:review-1')
  })

  it('opens a private idea through its version when that source is available', () => {
    const readablePrivateIdea = {
      ...privateIdea,
      content: { ...privateIdea.content, workTitle: 'Private idea book' },
      target: { ...privateIdea.target, bookVersionId: 'private-version-1' },
    } as const
    mocks.useActivity.mockReturnValue(activityResult([readablePrivateIdea]))

    render(<ActivityFeed scope="personal" targetId="user-1" type="all" />)
    fireEvent.click(screen.getByRole('button', { name: /Private idea book/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('idea:idea-1:private-version-1')
  })

  it('keeps restored management records non-actionable without implying current availability', () => {
    const restored = {
      kind: 'management', eventId: 'restored-event', eventType: 'work.restored', occurredAt: 1_800_000_000_000,
      actor: { id: 'manager-1', name: 'Manager', avatarKey: null }, libraryId: 'library-1', operationId: null,
      target: { kind: 'work', id: 'work-1', workId: 'work-1', versionId: null, authorId: null },
      content: { workTitle: 'The Book', objectLabel: 'Removed edition' },
    } as const
    const emptySnapshot = { ...restored, eventId: 'restored-empty-event', content: { workTitle: null, objectLabel: null } } as const
    mocks.useActivity.mockReturnValue(activityResult([restored, emptySnapshot], true))

    render(<ActivityFeed scope="library" targetId="library-1" type="management" />)

    expect(screen.getByText('The Book · Removed edition')).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('activity.workRestored'))).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /work-1/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link').map((link) => link.querySelector('.truncate')?.textContent)).toEqual(['Manager', 'Manager'])
  })

  it('loads operation children in additional pages and exposes retry on a group error', () => {
    mocks.useActivity.mockReturnValue(activityResult([group], true))
    mocks.useActivityGroup.mockReturnValue({
      data: { pages: [{ data: { items: [], nextCursor: 'child-next', canManage: true } }] },
      isPending: false, isError: false, isFetching: false, hasNextPage: true, isFetchingNextPage: false,
      refetch: mocks.refetchGroup, fetchNextPage: mocks.fetchGroupNext,
    })
    const view = render(<ActivityFeed scope="library" targetId="library-1" type="all" />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('activity.showItems', { count: 2 }) }))
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('activity.loadMore') })[0]!)
    expect(mocks.fetchGroupNext).toHaveBeenCalledOnce()

    mocks.useActivityGroup.mockReturnValue({
      data: undefined, isPending: false, isError: true, isFetching: false, hasNextPage: false, isFetchingNextPage: false,
      refetch: mocks.refetchGroup, fetchNextPage: mocks.fetchGroupNext,
    })
    view.rerender(<ActivityFeed scope="library" targetId="library-1" type="all" />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('errors.retry') }))
    expect(mocks.refetchGroup).toHaveBeenCalledOnce()
  })
})
