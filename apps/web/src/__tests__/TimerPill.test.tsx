import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import i18n from '../i18n/i18n'
import TimerPill from '../features/reader/components/TimerPill'
import { useToastStore } from '@/stores/toast.store'

const timer = {
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

  it('releasing the stop button before 600ms terminates and saves', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerUp(stop)
    expect(timer.terminate).toHaveBeenCalledTimes(1)
    expect(timer.discard).not.toHaveBeenCalled()
  })

  it('holding the stop button for 600ms discards without saving and toasts', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(600))
    expect(timer.discard).toHaveBeenCalledTimes(1)
    expect(timer.terminate).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.some((t) => t.message === '已丢弃本次记录')).toBe(true)
    // Releasing after the discard must not also terminate
    fireEvent.pointerUp(stop)
    expect(timer.terminate).not.toHaveBeenCalled()
  })

  it('leaving the button mid-press cancels the hold', () => {
    render(<TimerPill bookId="book-a" />)
    const stop = screen.getByTitle(STOP_TITLE)
    fireEvent.pointerDown(stop)
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerLeave(stop)
    act(() => vi.advanceTimersByTime(600))
    fireEvent.pointerUp(stop)
    expect(timer.terminate).not.toHaveBeenCalled()
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
