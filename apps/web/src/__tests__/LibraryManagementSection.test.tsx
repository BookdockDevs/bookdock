import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import LibraryManagementSection from '../features/settings/components/LibraryManagementSection'
import * as libraryHooks from '../features/library/hooks'
import { useAuthStore } from '../stores/auth.store'

vi.mock('../features/library/hooks', () => ({
  useLibraries: vi.fn(),
  useRemoveLibraryMember: vi.fn(),
  useCreateLibrary: vi.fn(),
}))

vi.mock('@/features/auth/AccountMenu', () => ({
  default: () => null,
}))

const baseLibrary = {
  ownerUserId: 'u1',
  description: '',
  createdAt: 1,
  updatedAt: 2,
}

const libraries = [
  { ...baseLibrary, id: 'lib-own', type: 'shared', name: 'Own Library', visibility: 'public', relation: 'owner' },
  { ...baseLibrary, id: 'lib-admin', type: 'shared', name: 'Admin Library', visibility: 'password', relation: 'admin' },
  { ...baseLibrary, id: 'lib-member', type: 'shared', name: 'Member Library', visibility: 'private', relation: 'member' },
  { ...baseLibrary, id: 'lib-public', type: 'shared', name: 'Public Library', visibility: 'public', relation: 'non-member' },
  { ...baseLibrary, id: 'lib-private', type: 'private', name: 'Private Library', visibility: null, relation: 'owner' },
]

function mockSection() {
  ;(libraryHooks.useLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: libraries },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  ;(libraryHooks.useRemoveLibraryMember as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useCreateLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner', avatarKey: null } as never })
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh-CN')
})

describe('LibraryManagementSection', () => {
  it('lists only the libraries the reader belongs to', () => {
    mockSection()

    render(<LibraryManagementSection />)

    expect(screen.getByText('Own Library')).toBeInTheDocument()
    expect(screen.getByText('Admin Library')).toBeInTheDocument()
    expect(screen.getByText('Member Library')).toBeInTheDocument()
    expect(screen.queryByText('Public Library')).toBeNull()
    expect(screen.queryByText('Private Library')).toBeNull()
  })

  it('offers manage but not leave on an owned row', () => {
    mockSection()

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])

    expect(screen.getByText('进入书库')).toBeInTheDocument()
    expect(screen.getByText('管理')).toBeInTheDocument()
    expect(screen.queryByText('退出书库')).toBeNull()
  })

  it('offers leave but not manage on a member row', () => {
    mockSection()

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[2])

    expect(screen.getByText('进入书库')).toBeInTheDocument()
    expect(screen.queryByText('管理')).toBeNull()
    expect(screen.getByText('退出书库')).toBeInTheDocument()
  })

  it('leaves a library through the membership endpoint after confirmation', () => {
    mockSection()
    const mutate = vi.fn()
    ;(libraryHooks.useRemoveLibraryMember as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[2])
    fireEvent.click(screen.getByText('退出书库'))
    fireEvent.click(screen.getByRole('button', { name: '退出书库' }))

    expect(mutate).toHaveBeenCalledWith(
      { libraryId: 'lib-member', userId: 'u1' },
      expect.anything(),
    )
  })

  it('opens the create dialog from the section action', () => {
    mockSection()

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getByRole('button', { name: '新建书库' }))

    expect(screen.getByLabelText('名称')).toBeInTheDocument()
  })
})
