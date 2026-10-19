import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useReadingSaveState } from '../lib/reading-record-queue'
import ReadingSaveIndicator from './ReadingSaveIndicator'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiPost: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

beforeEach(() => {
  useReadingSaveState.setState({ pending: 0, saveFailed: false, storageFailed: false })
})

it('stays quiet during saving, offers retry after failure, and clears after acknowledgement', () => {
  useReadingSaveState.setState({ pending: 1 })
  render(<ReadingSaveIndicator />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  act(() => useReadingSaveState.setState({ saveFailed: true }))
  expect(screen.getByRole('button')).toHaveTextContent('reader.readingSavePending')
  act(() => useReadingSaveState.setState({ pending: 0, saveFailed: false }))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('shows local persistence failure even without a pending server write', () => {
  useReadingSaveState.setState({ storageFailed: true })
  render(<ReadingSaveIndicator />)
  expect(screen.getByRole('button')).toHaveTextContent('reader.readingSaveStorageFailed')
})
