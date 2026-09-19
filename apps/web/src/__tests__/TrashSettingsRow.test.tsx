import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import TrashSettingsRow from '../features/settings/components/TrashSettingsRow'
import { apiPut } from '@/api/client'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(async () => ({ data: {} })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

function renderRow(trash: SettingsRes['trash']) {
  vi.mocked(apiPut).mockClear()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings'], { data: { trash } satisfies SettingsRes })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrashSettingsRow />
    </QueryClientProvider>,
  )
}

describe('TrashSettingsRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the retention row and an on switch by default', () => {
    renderRow({ autoCleanDays: 30 })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('settings.trashAutoClean')).toBeInTheDocument()
  })

  it('asks for confirmation before disabling and only then sends the toggle', async () => {
    renderRow({ autoCleanDays: 30 })
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByText('settings.trashDisableConfirm')).toBeInTheDocument()
    expect(apiPut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('settings.trashDisableConfirmAction'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { trash: { enabled: false } }))
  })

  it('cancelling the confirmation does not change the setting', async () => {
    renderRow({ autoCleanDays: 30 })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('library.cancel'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiPut).not.toHaveBeenCalled()
    expect(screen.queryByText('settings.trashDisableConfirm')).not.toBeInTheDocument()
  })

  it('hides the retention row and re-enables directly when off', async () => {
    renderRow({ autoCleanDays: 30, enabled: false })
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('settings.trashAutoClean')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.trashCap')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { trash: { enabled: true } }))
  })

  it('marks the stored cap pressed and saves the clicked cap', async () => {
    renderRow({ autoCleanDays: 30, maxTrashBytes: 1073741824 })
    expect(screen.getByRole('button', { name: 'settings.trashCap1GB' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'settings.trashCap5GB' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { trash: { maxTrashBytes: 5368709120 } }))
  })

  it('defaults the cap selection to unlimited when unset', () => {
    renderRow({ autoCleanDays: 30 })
    expect(screen.getByRole('button', { name: 'settings.trashCapUnlimited' })).toHaveAttribute('aria-pressed', 'true')
  })
})
