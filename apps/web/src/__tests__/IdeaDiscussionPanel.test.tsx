import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IdeaDiscussion } from '@bookdock/shared'

import IdeaDiscussionPanel from '../features/reader/components/IdeaDiscussionPanel'
import { useAuthStore } from '../stores/auth.store'

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), data: null as IdeaDiscussion | null }))
vi.mock('../features/reader/hooks/useIdeas', () => ({
  useIdeaDiscussion: () => ({ data: { data: mocks.data }, isPending: false, isError: false }),
  useIdeaAction: () => ({ mutateAsync: mocks.mutate, isPending: false }),
}))

describe('idea discussion interactions', () => {
  beforeEach(() => {
    mocks.mutate.mockReset().mockResolvedValue(null)
    useAuthStore.setState({ user: { id: 'member', username: 'member', role: 'member', avatarKey: null } })
    mocks.data = {
      idea: { id: 'idea', author: { id: 'author', name: 'author', avatarKey: null }, liked: false, likeCount: 1, commentCount: 1 } as unknown as IdeaDiscussion['idea'],
      likers: [{ id: 'author', name: 'author', avatarKey: null }],
      comments: [
        {
          id: 'comment',
          parentId: null,
          replyToId: null,
          replyToName: null,
          author: { id: 'author', name: 'author', avatarKey: null },
          body: 'Original comment',
          createdAt: 1,
          editedAt: null,
          deletedAt: null,
          own: false,
          canDelete: false,
          liked: false,
          likeCount: 0,
        },
      ],
    }
  })

  it('addresses replies to the selected comment and clears only successful drafts', async () => {
    render(<IdeaDiscussionPanel ideaId="idea" bookId="book" />)
    fireEvent.click(screen.getByText('Original comment'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Reply text' } })
    mocks.mutate.mockRejectedValueOnce(new Error('Rejected'))
    fireEvent.click(screen.getByRole('button', { name: 'comment.submit', exact: true }))
    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith({ type: 'comment', body: 'Reply text', replyToId: 'comment' }),
    )
    expect(screen.getByRole('textbox')).toHaveValue('Reply text')
    fireEvent.click(screen.getByRole('button', { name: 'comment.submit', exact: true }))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
  })

  it('shows liker identities in likes tab and toggles comment like', () => {
    render(<IdeaDiscussionPanel ideaId="idea" bookId="book" />)
    expect(screen.queryByRole('button', { name: 'comment.edit', exact: true })).toBeNull()
    expect(screen.queryByRole('button', { name: 'comment.delete', exact: true })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'comment.tabLikes', exact: true }))
    expect(screen.getByText('author', { exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'comment.tabComments', exact: true }))
    fireEvent.click(screen.getByTitle('comment.like'))
    expect(mocks.mutate).toHaveBeenCalledWith({ type: 'like', commentId: 'comment', liked: true })
  })

  it('opens context menu on right click and supports deleting with confirmation', async () => {
    mocks.data!.comments[0].canDelete = true
    render(<IdeaDiscussionPanel ideaId="idea" bookId="book" />)
    fireEvent.contextMenu(screen.getByText('Original comment'))
    const menu = document.getElementById('idea-comment-context-menu')!
    expect(menu).toBeInTheDocument()
    const deleteBtn = within(menu).getByRole('button', { name: 'comment.delete', exact: true })
    expect(deleteBtn).toBeInTheDocument()
    fireEvent.click(deleteBtn)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    const confirmDeleteBtn = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'comment.delete', exact: true })
    fireEvent.click(confirmDeleteBtn)
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({ type: 'delete', commentId: 'comment' }))
  })

  it('keeps guests read-only without a comment form or interaction buttons', () => {
    useAuthStore.setState({ user: null })
    render(<IdeaDiscussionPanel ideaId="idea" bookId="book" />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Original comment')).toBeInTheDocument()
  })
})
