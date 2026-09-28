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

  it('renders discoverable libraries and skips private personal libraries', () => {
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

    const searchInput = screen.getByPlaceholderText('搜索书库名称或描述...')
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

    const joinButton = screen.getByRole('button', { name: '加入书库' })
    fireEvent.click(joinButton)

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

    const pwdButton = screen.getByRole('button', { name: '输密加入' })
    fireEvent.click(pwdButton)

    expect(onJoinWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lib-pwd-1', name: 'Secret Society' }),
    )
  })

  it('shows joined status and allows entering an already joined library', () => {
    render(
      <LibraryDiscoveryDialog
        open
        onClose={onClose}
        onSelectLibrary={onSelectLibrary}
        onJoinWithPassword={onJoinWithPassword}
      />,
    )

    expect(screen.getByText('已加入')).toBeInTheDocument()
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

    const searchInput = screen.getByPlaceholderText('搜索书库名称或描述...')
    fireEvent.change(searchInput, { target: { value: 'NonexistentLibraryName' } })

    expect(screen.getByText('暂无可探索的书库')).toBeInTheDocument()
  })
})
