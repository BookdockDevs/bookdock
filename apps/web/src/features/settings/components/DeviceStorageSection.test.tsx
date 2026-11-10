import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeviceStorageSummary } from '@/features/local-library/repository'

import DeviceStorageSection from './DeviceStorageSection'

const inspectStorageMock = vi.fn<() => Promise<DeviceStorageSummary>>()

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${JSON.stringify(options)}` : key,
}))

vi.mock('@/features/local-library/catalog', () => ({
  DEVICE_VAULT_SCOPE: { kind: 'local', vaultId: 'device' },
  deviceCatalogOperations: () => ({
    inspectStorage: () => inspectStorageMock(),
  }),
}))

function renderSection(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }), active = true) {
  return render(
    <QueryClientProvider client={queryClient}>
      <DeviceStorageSection active={active} />
    </QueryClientProvider>,
  )
}

describe('DeviceStorageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders read-only device book count, file bytes, and browser total usage with no action buttons', async () => {
    inspectStorageMock.mockResolvedValue({
      activeBooks: 2,
      totalBytes: 3072,
      browserUsage: 4096,
    })

    renderSection()

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    expect(screen.getByText('settings.deviceStorageTitle')).toBeInTheDocument()
    expect(screen.getByText('settings.deviceStorageBooksUnit')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders placeholder dash when browser usage estimate is unavailable', async () => {
    inspectStorageMock.mockResolvedValue({
      activeBooks: 0,
      totalBytes: 0,
      browserUsage: null,
    })

    renderSection()

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
  })

  it('refreshes storage estimates on remount and when returning to the active settings tab', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    inspectStorageMock
      .mockResolvedValueOnce({ activeBooks: 1, totalBytes: 1024, browserUsage: 2048 })
      .mockResolvedValueOnce({ activeBooks: 1, totalBytes: 1024, browserUsage: 4096 })
      .mockResolvedValueOnce({ activeBooks: 1, totalBytes: 1024, browserUsage: 8192 })

    const first = renderSection(queryClient, true)
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    first.unmount()

    const second = renderSection(queryClient, true)
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument())

    second.rerender(
      <QueryClientProvider client={queryClient}>
        <DeviceStorageSection active={false} />
      </QueryClientProvider>,
    )
    second.rerender(
      <QueryClientProvider client={queryClient}>
        <DeviceStorageSection active={true} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument())
    expect(inspectStorageMock).toHaveBeenCalledTimes(3)
  })
})
