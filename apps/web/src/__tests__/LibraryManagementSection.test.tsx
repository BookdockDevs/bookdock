import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

import i18n from '../i18n/i18n'
import LibraryManagementSection from '../features/settings/components/LibraryManagementSection'
import * as libraryHooks from '../features/library/hooks'
import * as authHooks from '../features/auth/hooks'
import { useAuthStore } from '../stores/auth.store'

vi.mock('../features/library/hooks', () => ({
  useLibraries: vi.fn(),
  useRemoveLibraryMember: vi.fn(),
  useCreateLibrary: vi.fn(),
  useDeleteLibrary: vi.fn(),
  useHiddenLibraries: vi.fn(),
  useLibraryPrefs: vi.fn(),
  useUpdateLibraryPrefs: vi.fn(),
}))

vi.mock('../features/auth/hooks', () => ({
  useInstanceInfo: vi.fn(),
}))

vi.mock('@/features/auth/AccountMenu', () => ({
  default: () => null,
}))

const baseLibrary = {
  ownerUserId: 'u1',
  description: '',
  createdAt: 1,
  updatedAt: 2,
  memberCount: 1,
  workCount: 0,
  ownerUsername: 'tester',
}

const libraries = [
  { ...baseLibrary, id: 'lib-own', type: 'shared', name: 'Own Library', visibility: 'public', relation: 'owner', memberCount: 4, workCount: 12 },
  { ...baseLibrary, id: 'lib-admin', type: 'shared', name: 'Admin Library', visibility: 'password', relation: 'admin', memberCount: 7, workCount: 3 },
  { ...baseLibrary, id: 'lib-member', type: 'shared', name: 'Member Library', visibility: 'private', relation: 'member', memberCount: 2, workCount: 40 },
  { ...baseLibrary, id: 'lib-public', type: 'shared', name: 'Public Library', visibility: 'public', relation: 'non-member', memberCount: 9, workCount: 5 },
  { ...baseLibrary, id: 'lib-private', type: 'private', name: 'Private Library', visibility: null, relation: 'owner', memberCount: 1, workCount: 21 },
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
  ;(libraryHooks.useDeleteLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useHiddenLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
    hiddenIds: [],
    isHidden: () => false,
    setHidden: vi.fn(),
  })
  ;(libraryHooks.useLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
  ;(libraryHooks.useUpdateLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(authHooks.useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: { allowUserCreateLibrary: true, allowUserUpload: true } },
  })
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

  it('lists in the same manual order as the sidebar', () => {
    mockSection()
    ;(libraryHooks.useLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue({ libraryOrder: ['lib-member', 'lib-own'] })

    render(<LibraryManagementSection />)

    const order = Array.from(document.querySelectorAll('tbody tr')).map((row) => row.querySelector('span')?.textContent)
    expect(order.slice(0, 3)).toEqual(['Member Library', 'Own Library', 'Admin Library'])
  })

  it('lists member and work counts per row', () => {
    mockSection()

    render(<LibraryManagementSection />)

    const ownRow = screen.getByText('Own Library').closest('tr')!
    // Membership rows plus the owner, and the works a reader can open.
    expect(within(ownRow).getByText('4')).toBeInTheDocument()
    expect(within(ownRow).getByText('12')).toBeInTheDocument()
  })

  it('hides and shows a library from its own row menu, and keeps listing it here', () => {
    mockSection()
    const setHidden = vi.fn()
    ;(libraryHooks.useHiddenLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
      hiddenIds: ['lib-member'],
      isHidden: (id: string) => id === 'lib-member',
      setHidden,
    })

    render(<LibraryManagementSection />)

    // Hiding only affects the sidebar, so the row stays listed here — which is
    // why the same menu is where it comes back, with no separate section. The
    // label follows the state: hidden rows offer 显示, everyone else 隐藏.
    const hiddenRow = screen.getByText('Member Library').closest('tr')!
    fireEvent.click(within(hiddenRow).getByLabelText('更多操作'))
    fireEvent.click(screen.getByText('显示'))
    expect(setHidden).toHaveBeenCalledWith('lib-member', false)

    const shownRow = screen.getByText('Own Library').closest('tr')!
    fireEvent.click(within(shownRow).getByLabelText('更多操作'))
    fireEvent.click(screen.getByText('隐藏'))
    expect(setHidden).toHaveBeenCalledWith('lib-own', true)
  })

  it('offers manage and delete but not leave on an owned row', () => {
    mockSection()

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])

    expect(screen.queryByText('进入书库')).toBeNull()
    expect(screen.getByText('管理')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
    expect(screen.queryByText('退出书库')).toBeNull()
  })

  it('deletes an owned library through the endpoint after name confirmation', async () => {
    mockSection()
    const mutate = vi.fn()
    ;(libraryHooks.useDeleteLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: mutate, reset: vi.fn(), isPending: false })

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])
    fireEvent.click(screen.getByText('删除'))
    const confirm = screen.getByRole('button', { name: '删除书库' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Own Library' } })
    fireEvent.click(confirm)

    expect(mutate).toHaveBeenCalledWith(
      { libraryId: 'lib-own' },
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('keeps a failed deletion open for retry and clears input after closing', async () => {
    mockSection()
    const mutateAsync = vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(undefined)
    const reset = vi.fn()
    ;(libraryHooks.useDeleteLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, reset })
    render(<LibraryManagementSection />)
    function open() {
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      fireEvent.click(screen.getByText('删除'))
    }
    open()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Own Library' } })
    fireEvent.click(screen.getByRole('button', { name: '删除书库' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Own Library')
    expect(screen.getByRole('button', { name: '删除书库' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(reset).toHaveBeenCalledTimes(1)
    open()
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Own Library' } })
    fireEvent.click(screen.getByRole('button', { name: '删除书库' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mutateAsync).toHaveBeenCalledTimes(2)
  })

  it('blocks retry if a failed deletion has already removed the library', async () => {
    mockSection()
    const state = (libraryHooks.useLibraries as ReturnType<typeof vi.fn>).getMockImplementation()!()
    state.refetch.mockImplementation(async () => {
      state.data = { data: state.data.data.filter((library: LibraryListItem) => library.id !== 'lib-own') }
    })
    const mutateAsync = vi.fn().mockRejectedValue(new Error('Cleanup failed'))
    ;(libraryHooks.useDeleteLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, reset: vi.fn() })
    const { rerender } = render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])
    fireEvent.click(screen.getByText('删除'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Own Library' } })
    fireEvent.click(screen.getByRole('button', { name: '删除书库' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    rerender(<LibraryManagementSection />)
    expect(screen.getByRole('button', { name: '删除书库' })).toBeDisabled()
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })

  it('offers leave but not manage on a member row', () => {
    mockSection()

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[2])

    expect(screen.queryByText('进入书库')).toBeNull()
    expect(screen.queryByText('管理')).toBeNull()
    expect(screen.getByText('退出')).toBeInTheDocument()
  })

  it('leaves a library through the membership endpoint after confirmation', () => {
    mockSection()
    const mutate = vi.fn()
    ;(libraryHooks.useRemoveLibraryMember as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })

    render(<LibraryManagementSection />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[2])
    fireEvent.click(screen.getByText('退出'))
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

  it('hides the create entry when the instance switch is off for members', () => {
    mockSection()
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member', avatarKey: null } as never })
    ;(authHooks.useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: { allowUserCreateLibrary: false, allowUserUpload: true } },
    })

    render(<LibraryManagementSection />)

    expect(screen.queryByRole('button', { name: '新建书库' })).toBeNull()
  })

  it('keeps the create entry for the instance owner when the switch is off', () => {
    mockSection()
    ;(authHooks.useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: { allowUserCreateLibrary: false, allowUserUpload: true } },
    })

    render(<LibraryManagementSection />)

    expect(screen.getByRole('button', { name: '新建书库' })).toBeInTheDocument()
  })
})
