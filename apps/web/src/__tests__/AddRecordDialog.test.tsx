import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadingLedgerSession } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import AddRecordDialog from '@/features/reader/components/AddRecordDialog'

const state = vi.hoisted(() => ({ mutate: vi.fn(), update: vi.fn() }))
vi.mock('@/api/hooks/reading-records', async (original) => ({
  ...await original<typeof import('@/api/hooks/reading-records')>(),
  useAddReadingRecord: () => ({ mutate: state.mutate, isPending: false }),
  useUpdateSession: () => ({ mutate: state.update, isPending: false }),
}))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

function prepare() {
  render(<AddRecordDialog bookId="b1" variant="default" onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('reader.sessionStartPercent'), { target: { value: '62.32' } })
  fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '63.25' } })
  return screen.getByText('library.save').closest('form')!
}

beforeEach(() => vi.clearAllMocks())

describe('retroactive reading entry', () => {
  const session: ReadingLedgerSession = {
    id: 'session', roundId: 'round', source: 'manual', date: '2026-10-18',
    durationSeconds: 1813, startedAt: null, endedAt: null,
    startFraction: 0.2, endFraction: 0.4, progressScale: 0.8,
    coverage: [[0.2, 0.4]], fragments: [], timezone: 'UTC', wordCount: 80000,
  }

  it.each([0.8, null])('preserves original progress when editing only duration at scale %s', (progressScale) => {
    render(<AddRecordDialog bookId="b1" editingSession={{ ...session, progressScale }} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('readingData.markFinished')).not.toBeInTheDocument()
    expect(screen.getByLabelText('reader.sessionStartPercent')).toHaveProperty('disabled', progressScale === null)
    fireEvent.change(screen.getByLabelText('reader.addRecordMinutes'), { target: { value: '31' } })
    fireEvent.submit(screen.getByText('library.save').closest('form')!)
    const body = state.update.mock.calls[0][0].body
    expect(body.durationSeconds).toBe(1860)
    expect(body).not.toHaveProperty('startFraction')
    expect(body).not.toHaveProperty('endFraction')
  })

  it('converts edited display progress back to its original basis without rounding untouched facts', () => {
    render(<AddRecordDialog bookId="b1" editingSession={session} onClose={vi.fn()} />)
    expect(screen.getByLabelText('reader.sessionStartPercent')).toHaveValue(16)
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '40' } })
    fireEvent.submit(screen.getByText('library.save').closest('form')!)
    expect(state.update.mock.calls[0][0].body).toEqual({ endFraction: 0.5 })
  })

  it('does not turn a finished event into invented coverage', () => {
    render(<AddRecordDialog bookId="b1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('readingData.markFinished'))
    expect(screen.getByLabelText('reader.sessionEndPercent')).toHaveValue(null)
    fireEvent.submit(screen.getByText('library.save').closest('form')!)
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ finished: true })
    expect(state.mutate.mock.calls[0][0]).not.toHaveProperty('startFraction')
  })

  it('explains conflicts outside the current book and round without offering replacement', () => {
    const form = prepare()
    fireEvent.submit(form)
    act(() => state.mutate.mock.calls[0][1].onError(new ApiError('VALIDATION_ERROR', 'Overlap', {
      conflictingSessionIds: [], hasUnreplaceableConflicts: true,
    })))
    expect(screen.getByText('readingData.conflictAdjustTime')).toBeInTheDocument()
    expect(screen.queryByLabelText('readingData.replaceConflicts')).not.toBeInTheDocument()
  })

  it('accepts paired progress and preserves decimal precision', () => {
    const form = prepare()
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[0][0]).toEqual(expect.objectContaining({ startFraction: 0.6232, endFraction: 0.6325, source: 'retroactive' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('allows clearing the start time to submit without clock time', () => {
    render(<AddRecordDialog bookId="b1" variant="default" onClose={() => {}} />)
    fireEvent.click(screen.getByTitle('readingData.clearTime'))
    fireEvent.submit(screen.getByText('library.save').closest('form')!)
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ startedAt: null, continuous: false })
  })

  it('allows time-only retroactive records without inventing progress', () => {
    render(<AddRecordDialog bookId="b1" variant="default" onClose={() => {}} />)
    fireEvent.submit(screen.getByText('library.save').closest('form')!)
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ source: 'retroactive', durationSeconds: 1800 })
    expect(state.mutate.mock.calls[0][0]).not.toHaveProperty('startFraction')
    expect(state.mutate.mock.calls[0][0]).not.toHaveProperty('endFraction')
  })

  it('rejects partial or decreasing progress and permits equal bounds', () => {
    const form = prepare()
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '' } })
    fireEvent.submit(form)
    expect(state.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('readingData.requiredProgress')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '60' } })
    fireEvent.submit(form)
    expect(state.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('readingData.progressOrder')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '62.32' } })
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ startFraction: 0.6232, endFraction: 0.6232 })
  })

  it('reuses the submission identity on retry but changes it when the content changes', () => {
    const form = prepare()
    fireEvent.submit(form)
    const first = state.mutate.mock.calls[0][0].requestId
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[1][0].requestId).toBe(first)
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '65' } })
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[2][0].requestId).not.toBe(first)
  })

  it('only replaces conflicts after explicit consent, cleared when fields change', () => {
    const form = prepare()
    fireEvent.submit(form)
    act(() => state.mutate.mock.calls[0][1].onError(new ApiError('VALIDATION_ERROR', 'Overlap', { conflictingSessionIds: ['s1'] })))
    expect(screen.getByText('library.save')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('readingData.replaceConflicts'))
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[1][0].replaceSessionIds).toEqual(['s1'])
    fireEvent.change(screen.getByLabelText('reader.sessionEndPercent'), { target: { value: '65' } })
    expect(screen.queryByLabelText('readingData.replaceConflicts')).not.toBeInTheDocument()
    fireEvent.submit(form)
    expect(state.mutate.mock.calls[2][0]).not.toHaveProperty('replaceSessionIds')
  })

  it('prefills manual session facts, allows toggling markFinished, and calls onManualSaved on success', () => {
    const onManualSaved = vi.fn()
    const onClose = vi.fn()
    const manualSession = {
      bookId: 'b1',
      userId: 'u1',
      requestId: 'req-manual-1',
      timezone: 'Asia/Shanghai',
      date: '2026-10-25',
      phase: 'paused' as const,
      startedAt: Date.parse('2026-10-25T14:30:00Z'),
      elapsedMs: 45 * 60_000,
      lastResumeAt: null,
      suspendedAt: null,
      startCfi: 'epubcfi(/6/2!/4)',
      startFraction: 0.125,
      startChapterIndex: 1,
      lastCfi: 'epubcfi(/6/4!/8)',
      lastFraction: 0.375,
      lastChapterIndex: 2,
      fragments: [{ startedAt: 1000, endedAt: 2000 }],
      coverage: [[0.125, 0.375]] as [number, number][],
      revisionId: 'rev-1',
      wordCount: 50000,
    }

    render(
      <AddRecordDialog
        bookId="b1"
        variant="reader"
        manualSession={manualSession}
        initialFinished={true}
        onClose={onClose}
        onManualSaved={onManualSaved}
      />,
    )

    expect(screen.getByText('reader.manualTimerSaveTitle')).toBeInTheDocument()
    expect(screen.getByLabelText('reader.addRecordHours')).toHaveValue(0)
    expect(screen.getByLabelText('reader.addRecordMinutes')).toHaveValue(45)
    expect(screen.getByLabelText('reader.sessionStartPercent')).toHaveValue(12.5)
    expect(screen.getByLabelText('reader.sessionEndPercent')).toHaveValue(37.5)
    expect(screen.getByLabelText('readingData.markFinished')).toBeChecked()

    fireEvent.submit(screen.getByText('reader.manualTimerSave').closest('form')!)

    expect(state.mutate).toHaveBeenCalledTimes(1)
    const req = state.mutate.mock.calls[0][0]
    expect(req).toMatchObject({
      bookId: 'b1',
      source: 'manual',
      requestId: 'req-manual-1',
      finished: true,
      durationSeconds: 2700,
      startFraction: 0.125,
      endFraction: 0.375,
      revisionId: 'rev-1',
      wordCount: 50000,
    })

    act(() => state.mutate.mock.calls[0][1].onSuccess())
    expect(onManualSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
