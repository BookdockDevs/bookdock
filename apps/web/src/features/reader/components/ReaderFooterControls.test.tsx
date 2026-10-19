import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useReadingSaveState } from '../lib/reading-record-queue'
import ReaderFooterControls from './ReaderFooterControls'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiPost: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
vi.mock('./TimerPill', () => ({ default: () => <span>Manual timer</span> }))
vi.mock('./TtsPill', () => ({ default: () => null }))
vi.mock('./MediaOverlayPill', () => ({ default: () => null }))

beforeEach(() => {
  useReadingSaveState.setState({ pending: 1, saveFailed: true, storageFailed: true })
})

it.each(['auto', 'manual', 'both', 'off'])('keeps background save failures out of the reader in %s mode', (mode) => {
  const { container } = render(<ReaderFooterControls
    bookId="book-1"
    footerVisible
    isTouch={false}
    mobileDockVisible={false}
    onPointerEnter={() => {}}
    onPointerLeave={() => {}}
    readingTimerMode={mode}
  />)

  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText(/readingSave|待保存|重试|pending|retry/i)).not.toBeInTheDocument()
  expect(screen.queryByText('Manual timer') !== null).toBe(mode === 'manual' || mode === 'both')
  expect(useReadingSaveState.getState()).toMatchObject({ pending: 1, saveFailed: true, storageFailed: true })
  const wrapper = container.querySelector('[data-reader-corner-control]') as HTMLElement
  expect(wrapper).toHaveClass('pointer-events-none')
  expect(wrapper.firstElementChild).toHaveClass('pointer-events-auto')
  expect(wrapper.firstElementChild).toHaveAttribute('data-toast-obstacle', 'contents')
})
