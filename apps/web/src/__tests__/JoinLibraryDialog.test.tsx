import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ApiError } from '@/api/client'
import i18n from '../i18n/i18n'
import JoinLibraryDialog from '../features/library/components/JoinLibraryDialog'
import * as libraryHooks from '../features/library/hooks'

const MUTATE = vi.hoisted(() => vi.fn())
vi.mock('../features/library/hooks', () => ({ useJoinLibrary: vi.fn() }))

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ notify }))

describe('JoinLibraryDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    ;(libraryHooks.useJoinLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: MUTATE, isPending: false })
  })

  function renderDialog(needsPassword = true) {
    return render(
      <JoinLibraryDialog open libraryId="lib_1" needsPassword={needsPassword} onClose={vi.fn()} />,
    )
  }

  it('does not repeat the library name above the password field', () => {
    renderDialog()
    // The reader picked the library out of a list that already names it.
    expect(screen.queryByText('密码书库')).toBeNull()
    expect(screen.getByLabelText('访问密码')).toBeInTheDocument()
  })

  it('explains a wrong access password instead of a generic join failure', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '加入书库' }))

    const [, options] = MUTATE.mock.calls[0] as [unknown, { onError: (err: unknown) => void }]
    act(() => options.onError(new ApiError('INVALID_LIBRARY_PASSWORD', 'Wrong access password', 403)))

    // Expected form errors stay beside the input without a duplicate toast.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('访问密码不正确')
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('clears the error as soon as the reader types again', async () => {
    renderDialog()
    const input = screen.getByLabelText('访问密码')
    fireEvent.change(input, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '加入书库' }))
    const [, options] = MUTATE.mock.calls[0] as [unknown, { onError: (err: unknown) => void }]
    act(() => options.onError(new ApiError('INVALID_LIBRARY_PASSWORD', 'Wrong access password', 403)))
    await screen.findByRole('alert')

    fireEvent.change(input, { target: { value: 'w' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })
  it('resets a closed dialog and does not carry passwords to another library', () => {
    const onClose = vi.fn()
    const { rerender } = render(<JoinLibraryDialog open libraryId="lib_1" needsPassword onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'sample123' } })
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    rerender(<JoinLibraryDialog open libraryId="lib_2" needsPassword onClose={onClose} />)
    expect(screen.getByLabelText('访问密码')).toHaveValue('')
    expect(screen.getByLabelText('访问密码')).toHaveAttribute('type', 'password')
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'sample123' } })
    rerender(<JoinLibraryDialog open={false} libraryId="lib_2" needsPassword onClose={onClose} />)
    rerender(<JoinLibraryDialog open libraryId="lib_2" needsPassword onClose={onClose} />)
    expect(screen.getByLabelText('访问密码')).toHaveValue('')
  })

})
