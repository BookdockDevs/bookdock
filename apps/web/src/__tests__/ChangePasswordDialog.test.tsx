import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { useChangePassword } from '@/features/auth/hooks'
import ChangePasswordDialog from '../features/auth/ChangePasswordDialog'

vi.mock('@/features/auth/hooks', () => ({
  useChangePassword: vi.fn(),
}))

vi.mock('@/stores/toast.store', () => ({
  useToastStore: (selector: (state: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}))

describe('ChangePasswordDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useChangePassword as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  it('requires the current password before submitting', () => {
    const mutateAsync = vi.fn()
    ;(useChangePassword as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('library.save'))

    expect(screen.getByText('auth.errors.passwordRequired')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('requires a valid new password before submitting', () => {
    const mutateAsync = vi.fn()
    ;(useChangePassword as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('auth.oldPassword'), { target: { value: 'oldpass' } })
    fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'short' } })
    fireEvent.click(screen.getByText('library.save'))

    expect(screen.getByText('auth.passwordTooShort')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('submits the current and new password after local validation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    ;(useChangePassword as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('auth.oldPassword'), { target: { value: 'oldpass' } })
    fireEvent.change(screen.getByLabelText('auth.newPassword'), { target: { value: 'newpass12' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'newpass12' } })
    fireEvent.click(screen.getByText('library.save'))

    await vi.waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ oldPassword: 'oldpass', newPassword: 'newpass12' })
    })
  })
})
