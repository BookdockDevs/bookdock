import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import i18n from '../i18n/i18n'
import TimerPill from '../features/reader/components/TimerPill'
import { useToastStore } from '@/stores/toast.store'

const timer = {
  session: {
    bookId: 'book-a',
    userId: 'user-1',
    requestId: 'req-1',
    timezone: 'UTC',
    date: '2026-10-25',
    phase: 'running' as const,
    startedAt: 1000,
    elapsedMs: 12 * 60_000 + 34_000,
    lastResumeAt: null,
    suspendedAt: null,
    startCfi: null,
    startFraction: 0.1,
    startChapterIndex: 0,
    lastCfi: null,
    lastFraction: 0.2,
    lastChapterIndex: 1,
    fragments: [],
    coverage: [],
  },
  phase: 'running' as string,
  elapsedMs: 12 * 60_000 + 34_000,
  graceMs: 0,
  graceMinutes: 5,
  lastSummary: null,
  clearSummary: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  terminate: vi.fn(),
  discard: vi.fn(),
}

vi.mock('../features/reader/hooks/useManualTimer', () => ({
  useManualTimer: () => timer,
}))

vi.mock('../features/reader/components/AddRecordDialog', () => ({
  default: ({ bookId, onClose, onManualSaved }: any) => (
    <div data-testid="save-dialog">
      <span>{bookId}</span>
      <button onClick={onManualSaved}>Save</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const STOP_TITLE = '点击保存，长按丢弃'

describe('TimerPill', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    timer.phase = 'running'
    timer.elapsedMs = 12 * 60_000 + 34_000
    timer.graceMs = 0
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('idle renders only the round start button', () => {
    timer.phase = 'idle'
    render(<TimerPill bookId="book-a" />)
    fireEvent.click(screen.getByTitle('开始计时'))
    expect(timer.start).toHaveBeenCalledTimes(1)
    expect(screen.queryByTitle(STOP_TITLE)).toBeNull()
  })

  it('running renders the icon-less time capsule', () => {
    render(<TimerPill bookId="book-a" />)
    expect(screen.getByText('12:34')).toBeInTheDocument()
  })

  it('releasing the stop button before 600ms pauses and opens the save dialog', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerUp(stop)
    expect(timer.pause).toHaveBeenCalledTimes(1)
    expect(timer.discard).not.toHaveBeenCalled()
    expect(screen.getByTestId('save-dialog')).toBeInTheDocument()

    // Saving in dialog discards live session
    fireEvent.click(screen.getByText('Save'))
    expect(timer.discard).toHaveBeenCalledTimes(1)
  })

  it('holding the stop button for 600ms discards without saving and toasts', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(600))
    expect(timer.discard).toHaveBeenCalledTimes(1)
    expect(timer.pause).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.some((t) => (
      typeof t.message !== 'string'
      && t.message.key === 'reader.manualTimerDiscarded'
      && t.type === 'info'
    ))).toBe(true)
    // Releasing after the discard must not also open dialog
    fireEvent.pointerUp(stop)
    expect(screen.queryByTestId('save-dialog')).toBeNull()
  })

  it('leaving the button mid-press cancels the hold', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerLeave(stop)
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerUp(stop)
    expect(timer.pause).not.toHaveBeenCalled()
    expect(timer.discard).not.toHaveBeenCalled()
  })

  it('suspended renders the pause icon with the grace countdown and a resume button', () => {
    timer.phase = 'suspended'
    timer.graceMs = 4 * 60_000 + 12_000
    render(<TimerPill bookId="book-a" />)
    expect(screen.getByText('剩余 04:12')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('继续'))
    expect(timer.resume).toHaveBeenCalledTimes(1)
  })
})
