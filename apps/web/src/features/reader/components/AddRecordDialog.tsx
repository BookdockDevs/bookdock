import { useEffect, useState } from 'react'

import { localDateString, useAddReadingRecord } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

interface AddRecordDialogProps {
  bookId: string
  onClose: () => void
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900'
const labelCls = 'mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-400'

/**
 * Retroactive reading entry ("补录"): required date + duration; optional start
 * time (empty = startedAt NULL, hourly distribution skips the entry) and
 * start/end percent (both or neither; merged into read intervals by the
 * server without moving the reading position).
 */
export default function AddRecordDialog({ bookId, onClose }: AddRecordDialogProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const addRecord = useAddReadingRecord(bookId)
  const [date, setDate] = useState(localDateString())
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(30)
  const [startTime, setStartTime] = useState('')
  const [startPct, setStartPct] = useState('')
  const [endPct, setEndPct] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const durationSeconds = Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const hasStartPct = startPct !== ''
    const hasEndPct = endPct !== ''
    if (hasStartPct !== hasEndPct) {
      setError(_('reader.addRecordPercentPair'))
      return
    }
    const start = Number(startPct)
    const end = Number(endPct)
    if (hasStartPct && (end < start)) {
      setError(_('reader.addRecordPercentOrder'))
      return
    }
    // Without a start time the contract still requires endedAt: anchor the
    // block at noon of the entry day so the pair stays consistent
    const startedAt = startTime !== '' ? new Date(`${date}T${startTime}`).getTime() : null
    const endedAt = (startedAt ?? new Date(`${date}T12:00`).getTime()) + durationSeconds * 1000
    addRecord.mutate(
      {
        bookId,
        date,
        durationSeconds,
        startedAt,
        endedAt,
        ...(hasStartPct ? { startFraction: start / 100, endFraction: end / 100 } : {}),
      },
      {
        onSuccess: () => {
          addToast(_('reader.addRecordSuccess'), 'success')
          onClose()
        },
        onError: (err) => setError(err instanceof Error && err.message ? err.message : _('reader.sessionActionFailed')),
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {_('reader.addRecordTitle')}
        </h2>
        <div className="mb-3">
          <label htmlFor="addRecordDate" className={labelCls}>{_('reader.addRecordDate')}</label>
          <input
            id="addRecordDate"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div className="mb-3">
          <span className={labelCls}>{_('reader.addRecordDuration')}</span>
          <div className="flex items-center gap-2">
            <input
              aria-label={_('reader.addRecordHours')}
              type="number"
              min={0}
              max={24}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className={inputCls}
            />
            <span className="shrink-0 text-sm text-stone-600 dark:text-stone-400">{_('reader.addRecordHours')}</span>
            <input
              aria-label={_('reader.addRecordMinutes')}
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={inputCls}
            />
            <span className="shrink-0 text-sm text-stone-600 dark:text-stone-400">{_('reader.addRecordMinutes')}</span>
          </div>
        </div>
        <div className="mb-3">
          <label htmlFor="addRecordStartTime" className={labelCls}>{_('reader.addRecordStartTime')}</label>
          <input
            id="addRecordStartTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="mb-4 flex gap-3">
          <div className="flex-1">
            <label htmlFor="addRecordStartPct" className={labelCls}>{_('reader.sessionStartPercent')}</label>
            <input
              id="addRecordStartPct"
              type="number"
              min={0}
              max={100}
              value={startPct}
              onChange={(e) => setStartPct(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="addRecordEndPct" className={labelCls}>{_('reader.sessionEndPercent')}</label>
            <input
              id="addRecordEndPct"
              type="number"
              min={0}
              max={100}
              value={endPct}
              onChange={(e) => setEndPct(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {_('library.cancel')}
          </Button>
          <Button type="submit" disabled={addRecord.isPending || durationSeconds <= 0}>
            {_('library.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
