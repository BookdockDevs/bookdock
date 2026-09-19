import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { InstanceInfoRes } from '@bookdock/shared'

import UploadSettingsSection from '../features/settings/components/UploadSettingsSection'
import { apiPatch } from '@/api/client'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(async () => ({ data: {} })),
}))

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

function renderSection(uploadMaxBytes: number) {
  vi.mocked(apiPatch).mockClear()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['auth', 'instance'], {
    data: { initialized: true, allowRegistration: false, allowGuestAccess: false, uploadMaxBytes } satisfies InstanceInfoRes,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UploadSettingsSection />
    </QueryClientProvider>,
  )
}

describe('UploadSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the effective cap pressed and saves the clicked cap', async () => {
    renderSection(104857600)
    expect(screen.getByRole('button', { name: 'settings.uploadCap100MB' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'settings.uploadCap2GB' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/auth/instance', { uploadMaxBytes: 2147483648 }))
  })

  it('leaves every preset unselected when the effective cap is off-preset', () => {
    renderSection(157286400)
    for (const key of ['settings.uploadCap100MB', 'settings.uploadCap500MB', 'settings.uploadCap1GB', 'settings.uploadCap2GB', 'settings.uploadCap5GB']) {
      expect(screen.getByRole('button', { name: key })).toHaveAttribute('aria-pressed', 'false')
    }
  })
})
