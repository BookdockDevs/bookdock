import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import LibraryDiscoveryDialog from '../features/library/components/LibraryDiscoveryDialog'
import * as libraryHooks from '../features/library/hooks'

vi.mock('../features/library/hooks', () => ({
  useLibraries: vi.fn(),
  useJoinLibrary: vi.fn(),
}))

const baseLibrary = {
  ownerUserId: 'u1',
  createdAt: 1,
  updatedAt: 2,
  memberCount: 3,
  workCount: 7,
  ownerUsername: 'u1',
}

const mockLibraries = [
  {
    ...baseLibrary,
    id: 'lib-pub-1',
    type: 'shared' as const,
    name: 'Open Books',
    description: 'A great public book club',
    visibility: 'public' as const,
    relation: 'non-member' as const,
  },
  {
    ...baseLibrary,
    id: 'lib-pwd-1',
    type: 'shared' as const,
    name: 'Secret Society',
    description: 'Requires a secret key',
    visibility: 'password' as const,
    relation: 'non-member' as const,
  },
  {
    ...baseLibrary,
    id: 'lib-joined-1',
    type: 'shared' as const,
    name: 'Club Already Joined',
    description: 'Already a member here',
    visibility: 'public' as const,
    relation: 'member' as const,
  },
  {
    ...baseLibrary,
    id: 'lib-private-1',
    type: 'private' as const,
    name: 'My Personal Library',
    description: '',
    visibility: null,
    relation: 'owner' as const,
  },
  {
    ...baseLibrary,
    id: 'lib-invite-1',
    type: 'shared' as const,
    name: 'Invite Only Club',
    description: 'Reachable through its invitation link',
    visibility: 'private' as const,
    relation: 'owner' as const,
  },
]

describe('LibraryDiscoveryDialog', () => {
  const onClose = vi.fn()
  const onSelectLibrary = vi.fn()
  const onJoinWithPassword = vi.fn()
  const mutateJoin = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')

    ;(libraryHooks.useLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: mockLibraries },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    ;(libraryHooks.useJoinLibrary as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: mutateJoin,
      isPending: false,
    })
  })

  it('renders discoverable libraries and skips private ones, personal or invite-only', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    expect(screen.getByText('Open Books')).toBeInTheDocument()
    expect(screen.getByText('Secret Society')).toBeInTheDocument()
    expect(screen.getByText('Club Already Joined')).toBeInTheDocument()
    expect(screen.queryByText('My Personal Library')).toBeNull()
    expect(screen.queryByText('Invite Only Club')).toBeNull()
  })

  it('filters libraries based on search input', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const searchInput = screen.getByPlaceholderText('搜索书库名称或简介...')
    fireEvent.change(searchInput, { target: { value: 'Secret' } })

    expect(screen.getByText('Secret Society')).toBeInTheDocument()
    expect(screen.queryByText('Open Books')).toBeNull()
    expect(screen.queryByText('Club Already Joined')).toBeNull()
  })

  it('directly joins a public library when clicking join', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const joinButtons = screen.getAllByRole('button', { name: '加入' })
    fireEvent.click(joinButtons[0])

    expect(mutateJoin).toHaveBeenCalledWith(
      { libraryId: 'lib-pub-1' },
      expect.anything(),
    )
  })

  it('invokes onJoinWithPassword when clicking password library join button', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const joinButtons = screen.getAllByRole('button', { name: '加入' })
    fireEvent.click(joinButtons[1])

    expect(onJoinWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lib-pwd-1', name: 'Secret Society' }),
    )
  })

  it('shows entered button and allows entering an already joined library', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    expect(screen.queryByText('已加入')).toBeNull()
    const enterButton = screen.getByRole('button', { name: '进入' })
    fireEvent.click(enterButton)

    expect(onSelectLibrary).toHaveBeenCalledWith('lib-joined-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('displays empty state when no libraries match search query', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const searchInput = screen.getByPlaceholderText('搜索书库名称或简介...')
    fireEvent.change(searchInput, { target: { value: 'NonexistentLibraryName' } })

    expect(screen.getByText('暂无可探索的书库')).toBeInTheDocument()
  })

  it('renders book and member counts with tooltips on library cards', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    expect(screen.getAllByTitle('作品').length).toBeGreaterThan(0)
    expect(screen.getAllByTitle('成员').length).toBeGreaterThan(0)
  })

  it('opens details dialog when clicking a library card', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const card = screen.getByText('Open Books').closest('[role="button"]')!
    fireEvent.click(card)

    expect(screen.getByText('书库详情')).toBeInTheDocument()
  })

  it('opens details dialog when right-clicking a library card', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    const card = screen.getByText('Secret Society').closest('[role="button"]')!
    fireEvent.contextMenu(card)

    expect(screen.getByText('书库详情')).toBeInTheDocument()
  })
})
