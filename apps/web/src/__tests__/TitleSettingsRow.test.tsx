import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import TitleSettingsRow from '../features/settings/components/TitleSettingsRow'
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

function renderRow(library: SettingsRes['library']) {
  vi.mocked(apiPut).mockClear()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['settings'], { data: { library } satisfies SettingsRes })
  return render(
    <QueryClientProvider client={queryClient}>
      <TitleSettingsRow />
    </QueryClientProvider>,
  )
}

describe('TitleSettingsRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults the switch to on when the setting was never stored', () => {
    renderRow(undefined)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('sends the toggled value under the library key', async () => {
    renderRow({ normalizeTitle: true })
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { library: { normalizeTitle: false } }))
  })
})
