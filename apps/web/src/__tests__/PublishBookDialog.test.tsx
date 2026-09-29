import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { BookListItem, LibraryListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import PublishBookDialog from '../features/library/components/PublishBookDialog'
import { useAuthStore } from '../stores/auth.store'

const publishMutate = vi.fn()

vi.mock('../features/library/hooks', () => ({
  useLibraryCategories: () => ({ data: { data: [{ id: 'category-1', name: '分类' }] }, isLoading: false }),
  useLibraryTags: () => ({ data: { data: [{ id: 'tag-1', name: '标签' }] }, isLoading: false }),
  usePublishPrivateBook: () => ({ mutate: publishMutate, isPending: false }),
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
})
