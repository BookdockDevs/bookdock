import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
    options.onError(new ApiError('INVALID_LIBRARY_PASSWORD', 'Wrong access password', 403))

    // Both where the reader is typing and as a toast, and neither says "join failed".
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('访问密码不正确')
    expect(notify.error).toHaveBeenCalledWith({ key: 'errors.wrongLibraryPassword' })
  })

  it('clears the error as soon as the reader types again', async () => {
    renderDialog()
    const input = screen.getByLabelText('访问密码')
    fireEvent.change(input, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '加入书库' }))
    const [, options] = MUTATE.mock.calls[0] as [unknown, { onError: (err: unknown) => void }]
    options.onError(new ApiError('INVALID_LIBRARY_PASSWORD', 'Wrong access password', 403))
    await screen.findByRole('alert')

    fireEvent.change(input, { target: { value: 'w' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })
})
