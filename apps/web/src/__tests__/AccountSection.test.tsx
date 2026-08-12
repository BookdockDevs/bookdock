import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { useDeleteAvatar, useUpdateUsername } from '@/features/auth/hooks'
import i18n from '../i18n/i18n'
import AccountSection from '../features/settings/components/AccountSection'
import { useAuthStore } from '../stores/auth.store'

vi.mock('@/features/auth/hooks', () => ({
  useUploadAvatar: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateUsername: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useChangePassword: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

describe('AccountSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'owner', avatarKey: null } })
  })

  it('renders the username with a first-char placeholder when no avatar is set', () => {
    render(<AccountSection />)

    expect(screen.getByText('tester')).toBeInTheDocument()
    expect(screen.getByText('t')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the avatar image when avatarKey is set', () => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', role: 'owner', avatarKey: 'ab/abc123.png' },
    })
    render(<AccountSection />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/v1/avatars/ab/abc123.png')
    expect(screen.getByText('删除头像')).toBeInTheDocument()
  })

  it('accepts only whitelisted image types in the file picker', () => {
    render(<AccountSection />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,image/gif')
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByText('更换头像'))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('edits and saves the username', () => {
    const updateUsername = { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }
    vi.mocked(useUpdateUsername).mockReturnValue(updateUsername as unknown as ReturnType<typeof useUpdateUsername>)
    render(<AccountSection />)

    fireEvent.click(screen.getByText('修改'))
    const input = screen.getByDisplayValue('tester')
    fireEvent.change(input, { target: { value: '  newname  ' } })
    fireEvent.click(screen.getByText('保存'))
    expect(updateUsername.mutateAsync).toHaveBeenCalledWith({ username: 'newname' })
  })

  it('opens the change-password dialog from the account section', () => {
    render(<AccountSection />)

    expect(screen.queryByText('旧密码')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('修改密码'))
    expect(screen.getByText('旧密码')).toBeInTheDocument()
  })

  it('removes the avatar after confirmation', () => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'tester', role: 'owner', avatarKey: 'ab/abc123.png' },
    })
    const deleteAvatar = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteAvatar).mockReturnValue(deleteAvatar as unknown as ReturnType<typeof useDeleteAvatar>)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AccountSection />)

    fireEvent.click(screen.getByText('删除头像'))
    expect(window.confirm).toHaveBeenCalled()
    expect(deleteAvatar.mutate).toHaveBeenCalledWith(undefined, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })
})
