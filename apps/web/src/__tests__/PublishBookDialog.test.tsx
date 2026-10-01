import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { BookListItem, LibraryListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import PublishBookDialog from '../features/library/components/PublishBookDialog'
import { useAuthStore } from '../stores/auth.store'

const publishMutate = vi.fn()
const pushMutate = vi.fn()
let bookDetailData: unknown = undefined
// Rendered behind a real modal, so the confirm dialog portals out of it.

vi.mock('../features/library/hooks', () => ({
  useLibraryCategories: () => ({ data: { data: [{ id: 'category-1', name: '分类' }] }, isLoading: false }),
  useLibraryTags: () => ({ data: { data: [{ id: 'tag-1', name: '标签' }] }, isLoading: false }),
  usePublishPrivateBook: () => ({ mutate: publishMutate, isPending: false }),
  useBook: () => ({ data: bookDetailData }),
  usePushVersion: () => ({ mutate: pushMutate, isPending: false }),
}))

const book: BookListItem = {
  id: 'book-1', title: '测试书', author: '作者', format: 'epub', coverKey: null, size: 1,
  readStatus: 'reading', progress: 0, createdAt: 1, updatedAt: 1, shelfId: null, kind: 'personal',
}

const libraries: LibraryListItem[] = [
  { id: 'private-1', type: 'private', ownerUserId: 'user-1', name: '我的书库', description: '', visibility: null, relation: 'owner', memberCount: 3, workCount: 7, ownerUsername: 'u2', createdAt: 1, updatedAt: 1 },
  { id: 'shared-owner', type: 'shared', ownerUserId: 'user-1', name: '馆主书库', description: '', visibility: 'public', relation: 'owner', memberCount: 3, workCount: 7, ownerUsername: 'u2', createdAt: 1, updatedAt: 1 },
  { id: 'shared-admin', type: 'shared', ownerUserId: 'user-2', name: '管理书库', description: '', visibility: 'public', relation: 'admin', memberCount: 3, workCount: 7, ownerUsername: 'u2', createdAt: 1, updatedAt: 1 },
  { id: 'shared-member', type: 'shared', ownerUserId: 'user-3', name: '成员书库', description: '', visibility: 'public', relation: 'member', memberCount: 3, workCount: 7, ownerUsername: 'u2', createdAt: 1, updatedAt: 1 },
]

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  bookDetailData = undefined
  useAuthStore.setState({ user: { id: 'user-1', username: 'tester', role: 'owner' } })
  await i18n.changeLanguage('zh-CN')
})

describe('PublishBookDialog', () => {
  it('only lists shared libraries the user can manage', () => {
    render(<PublishBookDialog book={book} libraries={libraries} onClose={vi.fn()} onOpenLibrary={vi.fn()} />)

    expect(screen.getByRole('option', { name: '馆主书库' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '管理书库' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '成员书库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '我的书库' })).not.toBeInTheDocument()
  })

  it('submits the source, target taxonomy, and shows the success state', async () => {
    publishMutate.mockImplementation((_vars: unknown, callbacks: { onSuccess: (response: unknown) => void }) => {
      callbacks.onSuccess({ data: { libraryBookId: 'lb-1', versionLinkId: 'lbv-1', bookVersionId: 'book-2', duplicated: false } })
    })
    render(<PublishBookDialog book={book} libraries={libraries} onClose={vi.fn()} onOpenLibrary={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('书库分类'), { target: { value: 'category-1' } })
    fireEvent.click(screen.getByLabelText('标签'))
    fireEvent.click(screen.getByRole('button', { name: '发布' }))

    await waitFor(() => expect(publishMutate).toHaveBeenCalledWith(
      { libraryId: 'shared-owner', bookId: 'book-1', categoryId: 'category-1', tagIds: ['tag-1'] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    ))
    expect(screen.getByText('发布成功')).toBeInTheDocument()
  })

  it('shows the empty state when no target can be managed', () => {
    render(<PublishBookDialog book={book} libraries={[libraries[0]!]} onClose={vi.fn()} onOpenLibrary={vi.fn()} />)
    expect(screen.getByText('当前没有可发布的多人书库')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
  })

  it('remembers the last successful target for the current user', () => {
    publishMutate.mockImplementation((_vars: unknown, callbacks: { onSuccess: (response: unknown) => void }) => {
      callbacks.onSuccess({ data: { libraryBookId: 'lb-1', versionLinkId: 'lbv-1', bookVersionId: 'v-1', duplicated: false } })
    })
    const props = { book, libraries, onClose: vi.fn(), onOpenLibrary: vi.fn() }
    const { unmount } = render(<PublishBookDialog {...props} />)

    fireEvent.change(screen.getByLabelText('目标书库'), { target: { value: 'shared-admin' } })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    expect(localStorage.getItem('bd-publish-target-library:user-1')).toBe('shared-admin')

    unmount()
    const second = render(<PublishBookDialog {...props} />)
    expect(screen.getByLabelText('目标书库')).toHaveValue('shared-admin')

    second.unmount()
    useAuthStore.setState({ user: { id: 'user-2', username: 'other', role: 'owner' } })
    render(<PublishBookDialog {...props} />)
    expect(screen.getByLabelText('目标书库')).toHaveValue('shared-owner')
  })

  it('does not remember a cancelled selection and ignores an unavailable target', () => {
    const props = { book, libraries, onClose: vi.fn(), onOpenLibrary: vi.fn() }
    const { unmount } = render(<PublishBookDialog {...props} />)
    fireEvent.change(screen.getByLabelText('目标书库'), { target: { value: 'shared-admin' } })
    unmount()

    expect(localStorage.getItem('bd-publish-target-library:user-1')).toBeNull()
    const second = render(<PublishBookDialog {...props} />)
    expect(screen.getByLabelText('目标书库')).toHaveValue('shared-owner')
    second.unmount()

    localStorage.setItem('bd-publish-target-library:user-1', 'shared-admin')
    render(<PublishBookDialog {...props} libraries={libraries.filter((library) => library.id !== 'shared-admin')} />)
    expect(screen.getByLabelText('目标书库')).toHaveValue('shared-owner')
  })

  it('gives each published library the action its content state allows', () => {
    bookDetailData = {
      data: {
        publishedTo: [
          { libraryId: 'lib_city', libraryName: 'City', libraryBookId: 'lb1', versionLinkId: 'lbv1', versionName: '', inSync: true, cityMoved: false, sourceMoved: false },
          { libraryId: 'lib_town', libraryName: 'Town', libraryBookId: 'lb2', versionLinkId: 'lbv2', versionName: '精校版', inSync: false, cityMoved: true, sourceMoved: false },
          { libraryId: 'lib_split', libraryName: 'Split', libraryBookId: 'lb4', versionLinkId: 'lbv4', versionName: '', inSync: false, cityMoved: true, sourceMoved: true },
          { libraryId: 'lib_a', libraryName: 'A', libraryBookId: 'lb3', versionLinkId: 'lbv3', versionName: '', inSync: false, cityMoved: false, sourceMoved: true },
        ],
      },
    }
    const onOpenLibrary = vi.fn()
    render(<PublishBookDialog book={book} libraries={libraries} onClose={vi.fn()} onOpenLibrary={onOpenLibrary} />)

    expect(screen.getByText('已发布书库')).toBeInTheDocument()
    expect(screen.getByText('内容同步')).toBeInTheDocument()
    // The library moving ahead of an untouched copy reads differently from both
    // sides having edited: the second one is a dead end for this book's future
    // pushes, and the row has to say so rather than look like the first.
    expect(screen.getByText('书库已更新')).toBeInTheDocument()
    expect(screen.getByText('内容已分叉')).toBeInTheDocument()
    expect(screen.getByText('内容更新')).toBeInTheDocument()

    // In sync: nothing to send. Library ahead, either way: the server refuses a
    // push, so the row opens that library instead. This book ahead: push.
    const pushButton = screen.getByRole('button', { name: '推送更新' })
    const viewButtons = screen.getAllByRole('button', { name: '查看书库版本' })
    expect(viewButtons).toHaveLength(2)

    fireEvent.click(viewButtons[0]!)
    expect(onOpenLibrary).toHaveBeenCalledWith('lib_town')
    fireEvent.click(viewButtons[1]!)
    expect(onOpenLibrary).toHaveBeenCalledWith('lib_split')

    fireEvent.click(pushButton)
    // The confirm states the consequence and names the target, so a book
    // published to several libraries cannot be pushed into the wrong one.
    const confirm = within(screen.getByRole('alertdialog'))
    expect(confirm.getByText('将用本书当前内容更新「A」，目标书库中现有的内容将被替换。确定继续吗？')).toBeInTheDocument()
    fireEvent.click(confirm.getByRole('button', { name: '确认推送' }))
    expect(pushMutate).toHaveBeenCalledWith(
      { libraryId: 'lib_a', libraryBookId: 'lb3', versionLinkId: 'lbv3' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('includes the version name when the library version has one', () => {
    bookDetailData = {
      data: {
        publishedTo: [
          { libraryId: 'lib_town', libraryName: '试读会', libraryBookId: 'lb2', versionLinkId: 'lbv2', versionName: '精校版', inSync: false, cityMoved: false, sourceMoved: false },
        ],
      },
    }
    render(<PublishBookDialog book={book} libraries={libraries} onClose={vi.fn()} onOpenLibrary={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '推送更新' }))
    expect(screen.getByText(/将用本书当前内容更新「试读会 · 精校版」/)).toBeInTheDocument()
  })

  it('never promises a rollback for a push', () => {
    // The push overwrites what the library serves and no surface restores it,
    // so the confirm copy must not sell it as reversible or as keeping history.
    bookDetailData = {
      data: {
        publishedTo: [
          { libraryId: 'lib_city', libraryName: 'City', libraryBookId: 'lb1', versionLinkId: 'lbv1', versionName: '', inSync: false, cityMoved: false, sourceMoved: false },
        ],
      },
    }
    render(<PublishBookDialog book={book} libraries={libraries} onClose={vi.fn()} onOpenLibrary={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '推送更新' }))
    const confirm = within(screen.getByRole('alertdialog')).getByText(/将用本书当前内容更新/)
    expect(confirm.textContent).not.toMatch(/撤回|还原|恢复|历史/)
  })
})
