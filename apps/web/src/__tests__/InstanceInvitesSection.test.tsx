import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { INSTANCE_INVITE_RANDOM_LENGTH } from '@bookdock/shared'
import InstanceInvitesSection from '../features/settings/components/InstanceInvitesSection'
import * as authHooks from '@/features/auth/hooks'
import { useLibraries } from '@/features/library/hooks'
import { notify } from '@/lib/notifications'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'auth.inviteAutoJoinSeparator') return '、'
    if (!params) return key
    return `${key}:${Object.values(params).join('/')}`
  },
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/features/auth/hooks', () => ({
  useInstanceInvites: vi.fn(),
  useCreateInstanceInvite: vi.fn(),
  useDeleteInstanceInvite: vi.fn(),
}))

vi.mock('@/features/library/hooks', () => ({
  useLibraries: vi.fn(),
}))

describe('InstanceInvitesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    ;(useLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [
          { id: 'priv-1', type: 'private', name: '', relation: 'owner' },
          { id: 'lib-owner', type: 'shared', name: 'Owner Club', relation: 'owner' },
          { id: 'lib-admin', type: 'shared', name: 'Admin Club', relation: 'admin' },
          { id: 'lib-member', type: 'shared', name: 'Member Only', relation: 'member' },
        ],
      },
    })
    ;(authHooks.useCreateInstanceInvite as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(authHooks.useDeleteInstanceInvite as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  it('renders skeleton loading state and single-line empty state without card description', () => {
    ;(authHooks.useInstanceInvites as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    })

    const { rerender } = render(<InstanceInvitesSection />)
    expect(screen.getByLabelText('admin.inviteLoading')).toHaveAttribute('aria-busy', 'true')

    ;(authHooks.useInstanceInvites as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { data: [] },
    })
    rerender(<InstanceInvitesSection />)

    expect(screen.getByText('admin.inviteEmpty')).toBeInTheDocument()

    ;(useLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: [{ id: 'priv-1', type: 'private', name: '', relation: 'owner' }] },
    })
    fireEvent.click(screen.getByText('admin.createInvite'))
    expect(screen.queryByText('admin.inviteAutoJoinLibrary')).not.toBeInTheDocument()
  })

  it('lists invites with label title and inline auto-join metadata, copies via icon buttons, and deletes invite', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue({ data: { id: 'inv-1' } })
    ;(authHooks.useInstanceInvites as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        data: [
          {
            id: 'inv-1',
            code: '书香2026',
            label: '群口令',
            autoJoinLibraries: [
              { id: 'lib-owner', name: 'Owner Club' },
              { id: 'lib-admin', name: 'Admin Club' },
            ],
            maxUses: 10,
            usedCount: 2,
            expiresAt: null,
            createdAt: 1700000000000,
            status: 'active',
          },
          {
            id: 'inv-2',
            code: 'OLD123',
            label: '',
            autoJoinLibraries: [],
            maxUses: 1,
            usedCount: 1,
            expiresAt: null,
            createdAt: 1690000000000,
            status: 'exhausted',
          },
        ],
      },
    })
    ;(authHooks.useDeleteInstanceInvite as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    })

    render(<InstanceInvitesSection />)

    expect(screen.getByText('群口令')).toBeInTheDocument()
    expect(screen.getByText('书香2026')).toBeInTheDocument()
    expect(screen.getByText('OLD123')).toBeInTheDocument()
    expect(screen.getByText('admin.inviteStatusExhausted')).toBeInTheDocument()
    expect(screen.getByText(/admin\.inviteAutoJoinInline:Owner Club、Admin Club/)).toBeInTheDocument()

    const copyCodeButtons = screen.getAllByRole('button', { name: 'admin.inviteCopyCode' })
    fireEvent.click(copyCodeButtons[0]!)
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('书香2026')
    })

    const copyLinkButtons = screen.getAllByRole('button', { name: 'admin.inviteCopyLink' })
    fireEvent.click(copyLinkButtons[0]!)
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/register?invite=${encodeURIComponent('书香2026')}`,
      )
    })

    const deleteButtons = screen.getAllByRole('button', { name: 'admin.inviteDelete' })
    fireEvent.click(deleteButtons[0]!)
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'admin.inviteDelete' }))
    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith('inv-1')
    })
    expect(notify.success).toHaveBeenCalledWith('admin.inviteDeleted')
  })

  it('requires invite code or inline random generation, supports steppers and toggles, and binds multi-select shared libraries', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    ;(authHooks.useInstanceInvites as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { data: [] },
    })
    ;(authHooks.useCreateInstanceInvite as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync,
      isPending: false,
    })

    render(<InstanceInvitesSection />)
    fireEvent.click(screen.getByText('admin.createInvite'))

    // Note uses Optional placeholder; empty code triggers inline required error
    expect(screen.getByLabelText('admin.inviteLabelField')).toHaveAttribute('placeholder', 'admin.inviteLabelPlaceholder')

    fireEvent.click(screen.getByText('admin.inviteCreateSubmit'))
    expect(screen.getByText('auth.errors.inviteCodeRequired')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()

    // Inline Random icon button generates a 6-char code and clears required error
    const codeInput = screen.getByLabelText('admin.inviteCodeLabel') as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteRandomize' }))
    expect(codeInput.value).toHaveLength(INSTANCE_INVITE_RANDOM_LENGTH)
    expect(screen.queryByText('auth.errors.inviteCodeRequired')).not.toBeInTheDocument()

    // Override with custom code, switch max uses to limited (stepper 5 -> 6), switch validity to limited (hours)
    fireEvent.change(codeInput, { target: { value: 'bookclub' } })
    fireEvent.change(screen.getByLabelText('admin.inviteLabelField'), { target: { value: '读书群' } })

    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteUsesLimited' }))
    const usesInput = screen.getByRole('textbox', { name: 'admin.inviteMaxUses' })
    fireEvent.change(usesInput, { target: { value: '-99abc' } })
    expect(usesInput).toHaveValue('99')
    fireEvent.change(usesInput, { target: { value: '' } })
    fireEvent.blur(usesInput)
    expect(usesInput).toHaveValue('5')
    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteMaxUses +' }))

    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteExpiresLimited' }))
    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteUnitHours' }))
    fireEvent.click(screen.getByRole('button', { name: 'admin.inviteExpiresIn -' }))

    // Multi-select pills exclude Member Only library and allow picking multiple owner/admin libraries
    expect(screen.queryByRole('button', { name: 'Member Only' })).not.toBeInTheDocument()
    const ownerChip = screen.getByRole('button', { name: 'Owner Club' })
    const adminChip = screen.getByRole('button', { name: 'Admin Club' })
    fireEvent.click(ownerChip)
    fireEvent.click(adminChip)
    expect(ownerChip).toHaveAttribute('aria-pressed', 'true')
    expect(adminChip).toHaveAttribute('aria-pressed', 'true')

    const beforeSubmit = Date.now()
    fireEvent.click(screen.getByText('admin.inviteCreateSubmit'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1)
    })
    const payload = mutateAsync.mock.calls[0]![0]
    expect(payload.code).toBe('BOOKCLUB')
    expect(payload.label).toBe('读书群')
    expect(payload.autoJoinLibraryIds).toEqual(['lib-owner', 'lib-admin'])
    expect(payload.maxUses).toBe(6)
    expect(payload.expiresAt).toBeGreaterThanOrEqual(beforeSubmit + 6 * 60 * 60 * 1000 - 1000)
    expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + 6 * 60 * 60 * 1000 + 1000)
  })
})
