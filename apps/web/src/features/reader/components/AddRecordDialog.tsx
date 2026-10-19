import { useMemo, useRef, useState } from 'react'

import type { ReadingLedgerSession, ReadingRecordConflictDetails, ReadingRecordCreateReq, ReadingSessionUpdateReq } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { localDateString, useAddReadingRecord, useUpdateSession } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import Toggle from '@/components/ui/Toggle'
import { ledgerProgressBounds } from '@/features/archive/components/reading-ledger-stats'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

import { markEscConsumed } from '../lib/esc-consumed'

interface AddRecordDialogProps {
  bookId: string
  onClose: () => void
  variant?: 'default' | 'reader'
  initialStartFraction?: number
  editingSession?: ReadingLedgerSession | null
}

const DURATION_PRESETS = [15, 30, 45, 60]

function currentHourMinute(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export default function AddRecordDialog({
  bookId,
  onClose,
  variant = 'reader',
  initialStartFraction,
  editingSession,
}: AddRecordDialogProps) {
  const _ = useTranslation()
  const addRecord = useAddReadingRecord(bookId)
  const updateSession = useUpdateSession()
  const isEditing = Boolean(editingSession)
  const progressBounds = editingSession ? ledgerProgressBounds(editingSession) : null
  const initialStartPct = progressBounds ? progressBounds.start === null ? '' : String(Number((progressBounds.start * 100).toFixed(4))) : initialStartFraction === undefined ? '' : String(initialStartFraction * 100)
  const initialEndPct = progressBounds?.end == null ? '' : String(Number((progressBounds.end * 100).toFixed(4)))
  const progressEditable = !progressBounds || (progressBounds.scale !== null && progressBounds.scale > 0)
  const maxProgress = progressBounds?.scale == null ? 100 : progressBounds.scale * 100

  const [date, setDate] = useState(() => editingSession?.date ?? localDateString())
  const [hours, setHours] = useState(() => {
    if (editingSession) {
      const totalMins = Math.round((editingSession.durationSeconds || 0) / 60)
      return Math.floor(totalMins / 60)
    }
    return 0
  })
  const [minutes, setMinutes] = useState(() => {
    if (editingSession) {
      const totalMins = Math.round((editingSession.durationSeconds || 0) / 60)
      return totalMins % 60
    }
    return 30
  })
  // Default start time to session's startedAt, or current time for new record
  const [startTime, setStartTime] = useState(() => {
    if (editingSession) {
      if (editingSession.startedAt) {
        const d = new Date(editingSession.startedAt)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      }
      return ''
    }
    return currentHourMinute()
  })
  const [startPct, setStartPct] = useState(initialStartPct)
  const [finished, setFinished] = useState(false)
  const [endPct, setEndPct] = useState(initialEndPct)
  const submission = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [replaceConflicts, setReplaceConflicts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Custom Calendar Popover state (inspired by PeriodSelector)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [datePickerPos, setDatePickerPos] = useState<SmartPosition | null>(null)
  const dateTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dateMenuRef = useRef<HTMLDivElement | null>(null)

  const [calYear, setCalYear] = useState(() => {
    const d = new Date(date)
    return Number.isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear()
  })
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(date)
    return Number.isNaN(d.getMonth()) ? new Date().getMonth() : d.getMonth()
  })

  function toggleDatePicker() {
    if (datePickerOpen) {
      setDatePickerOpen(false)
      return
    }
    const el = dateTriggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDatePickerPos(
      computeDropdownPosition(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        260,
        280,
        'start',
      ),
    )
    const current = new Date(date)
    if (!Number.isNaN(current.getFullYear())) {
      setCalYear(current.getFullYear())
      setCalMonth(current.getMonth())
    }
    setDatePickerOpen(true)
  }

  const handleClose = () => {
    markEscConsumed()
    onClose()
  }

  const durationSeconds = Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60
  const isReader = variant === 'reader'

  const [startH, startM] = useMemo(() => {
    if (!startTime) return ['', '']
    const parts = startTime.split(':')
    return [parts[0] ?? '', parts[1] ?? '']
  }, [startTime])

  function handleHourChange(val: string) {
    if (val === '') {
      setStartTime('')
      return
    }
    const num = parseInt(val, 10)
    if (!Number.isNaN(num)) {
      const clamped = Math.max(0, Math.min(23, num))
      const h = String(clamped).padStart(2, '0')
      const m = startM || '00'
      setStartTime(`${h}:${m}`)
    }
  }

  function handleMinuteChange(val: string) {
    const num = parseInt(val, 10)
    if (val === '') {
      const h = startH || '00'
      setStartTime(`${h}:00`)
      return
    }
    if (!Number.isNaN(num)) {
      const clamped = Math.max(0, Math.min(59, num))
      const h = startH || '00'
      const m = String(clamped).padStart(2, '0')
      setStartTime(`${h}:${m}`)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const hasStartPct = startPct !== ''
    const hasEndPct = endPct !== ''
    const progressChanged = startPct !== initialStartPct || endPct !== initialEndPct
    if ((!isEditing || progressChanged) && hasStartPct !== hasEndPct) {
      setError(_('readingData.requiredProgress'))
      return
    }
    const start = Number(startPct)
    const end = Number(endPct)
    if ((!isEditing || progressChanged) && hasStartPct && end < start) {
      setError(_('readingData.progressOrder'))
      return
    }
    const startedAt = startTime !== '' ? new Date(`${date}T${startTime}`).getTime() : null
    const endedAt = (startedAt ?? new Date(`${date}T12:00`).getTime()) + durationSeconds * 1000

    if (isEditing && editingSession) {
      const body: ReadingSessionUpdateReq = {}
      const originalTime = editingSession.startedAt ? new Date(editingSession.startedAt) : null
      const originalStartTime = originalTime ? `${String(originalTime.getHours()).padStart(2, '0')}:${String(originalTime.getMinutes()).padStart(2, '0')}` : ''
      const durationChanged = durationSeconds !== Math.round(editingSession.durationSeconds / 60) * 60
      const positionInTimeChanged = date !== editingSession.date || startTime !== originalStartTime
      if (durationChanged || positionInTimeChanged) {
        const duration = durationChanged ? durationSeconds : editingSession.durationSeconds
        const startAt = positionInTimeChanged ? startedAt : editingSession.startedAt
        Object.assign(body, {
          date, durationSeconds: duration, startedAt: startAt,
          ...(startAt !== null ? { endedAt: startAt + duration * 1000 } : {}),
          continuous: startAt !== null && (positionInTimeChanged || editingSession.fragments.length > 0),
          timezone: positionInTimeChanged ? Intl.DateTimeFormat().resolvedOptions().timeZone : editingSession.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }
      if (progressEditable && progressChanged) {
        const scale = progressBounds?.scale ?? 1
        if (startPct !== initialStartPct) body.startFraction = hasStartPct ? start / 100 / scale : null
        if (endPct !== initialEndPct) body.endFraction = hasEndPct ? end / 100 / scale : null
      }
      updateSession.mutate(
        {
          id: editingSession.id,
          body,
        },
        {
          onSuccess: () => {
            notify.success({ key: 'reader.sessionUpdated' })
            handleClose()
          },
          onError: (err) => {
            setError(getUserErrorMessage(err, _, 'reader.sessionActionFailed'))
          },
        },
      )
      return
    }

    const body: ReadingRecordCreateReq = {
      bookId, date, durationSeconds, startedAt, endedAt,
      source: 'retroactive', continuous: startTime !== '', finished,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(hasStartPct ? { startFraction: start / 100, endFraction: end / 100 } : {}),
      ...(replaceConflicts ? { replaceSessionIds: conflicts } : {}),
    }
    const fingerprint = JSON.stringify(body)
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, requestId: crypto.randomUUID() }
    addRecord.mutate(
      { ...body, requestId: submission.current.requestId },
      {
        onSuccess: () => {
          notify.success({ key: 'reader.addRecordSuccess' })
          handleClose()
        },
        onError: (err) => {
          setError(getUserErrorMessage(err, _, 'reader.sessionAddFailed'))
          if (err instanceof ApiError && err.details && typeof err.details === 'object' && 'conflictingSessionIds' in err.details) {
            if ((err.details as Partial<ReadingRecordConflictDetails>).hasUnreplaceableConflicts === true) {
              setError(_('readingData.conflictAdjustTime'))
              setConflicts([])
              return
            }
            const ids = err.details.conflictingSessionIds
            if (Array.isArray(ids) && ids.every((id): id is string => typeof id === 'string')) {
              setConflicts(ids)
              setReplaceConflicts(false)
            }
          }
        },
      },
    )
  }

  // Consistent night/dark theme styles (avoiding washed-out milky backgrounds)
  const cardCls = cn(
    'rounded-2xl border p-3.5 transition-colors',
    isReader
      ? 'border-[var(--bd-read-accent)]/80 bg-transparent'
      : 'border-stone-200/80 bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900/60',
  )

  const inputCls = cn(
    'h-8.5 rounded-xl border px-3 text-sm outline-none transition-all [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    isReader
      ? 'border-[var(--bd-read-accent)] bg-transparent text-[var(--bd-read-text)] placeholder:text-[var(--bd-read-sub)]/40 focus:border-[var(--bd-read-primary)]'
      : 'border-stone-200 bg-white text-stone-800 placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-stone-300 dark:focus:ring-stone-300',
  )

  const labelTextCls = isReader ? 'text-[var(--bd-read-text)]' : 'text-stone-700 dark:text-stone-200'
  const subTextCls = isReader ? 'text-[var(--bd-read-sub)]' : 'text-stone-400 dark:text-stone-500'
  const dividerCls = isReader ? 'border-[var(--bd-read-accent)]/60' : 'border-stone-200/60 dark:border-stone-800/60'

  // Clean label names: strip "(可选)" or "(选填)" per project convention, use asterisk for required
  const cleanStartTimeLabel = _('reader.addRecordStartTime').replace(/（.*?）|\(.*?\)/g, '').trim()
  const cleanProgressLabel = _('readingData.progressOptional').replace(/（.*?）|\(.*?\)/g, '').trim()

  // Calendar calculations
  const firstDayOfMonth = new Date(calYear, calMonth, 1)
  const startOffset = (firstDayOfMonth.getDay() + 6) % 7 // Monday = 0
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate()

  const isPending = addRecord.isPending || updateSession.isPending

  return (
    <Modal
      title={isEditing ? _('readingData.editRecord') : _('reader.addRecordTitle')}
      onClose={handleClose}
      size="sm"
      variant={variant}
    >
      <form
        onSubmit={handleSubmit}
        onChange={(event) => {
          if (event.target instanceof HTMLInputElement && event.target.name === 'replaceConflicts') return
          setConflicts([])
          setReplaceConflicts(false)
        }}
        className="flex flex-col gap-3.5"
      >
        <fieldset disabled={isPending} className="flex flex-col gap-3.5">
          {/* Card 1: 日期与时间 (Date, Start Time & Duration) */}
          <div className={cardCls}>
            {/* 1.1 日期行 (Custom Calendar Picker, compact without awkward middle gap) */}
            <div className="flex items-center justify-between gap-3">
              <span className={cn('text-sm font-medium', labelTextCls)}>
                {_('reader.addRecordDate')}
                <span className="text-red-500"> *</span>
              </span>

              <button
                ref={dateTriggerRef}
                type="button"
                onClick={toggleDatePicker}
                aria-label={_('reader.addRecordDate')}
                className={cn(
                  'inline-flex h-8.5 items-center gap-2 rounded-xl border px-2.5 text-xs font-medium cursor-pointer transition-colors',
                  inputCls,
                )}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={subTextCls} aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span className="font-mono tabular-nums">{date}</span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('transition-transform duration-150', subTextCls, datePickerOpen && 'rotate-180')}
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>

            {/* Custom Date Popover */}
            {datePickerOpen && (
              <SmartMenu
                innerRef={dateMenuRef}
                triggerRef={dateTriggerRef}
                position={datePickerPos}
                onClose={() => setDatePickerOpen(false)}
                width={260}
                variant={variant}
                className={cn(
                  'rounded-xl border p-2.5 shadow-xl',
                  isReader
                    ? 'border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] text-[var(--bd-read-text)]'
                    : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 text-stone-900 dark:text-stone-100',
                )}
              >
                {/* Month header with prev/next */}
                <div className="flex items-center justify-between border-b pb-1.5 pt-0.5 px-1 border-stone-200/60 dark:border-stone-800/60">
                  <button
                    type="button"
                    onClick={() => {
                      if (calMonth === 0) {
                        setCalYear((y) => y - 1)
                        setCalMonth(11)
                      } else {
                        setCalMonth((m) => m - 1)
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-500/10 cursor-pointer"
                    aria-label="Previous Month"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {_('readingData.yearMonth', { year: calYear, month: calMonth + 1 })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (calMonth === 11) {
                        setCalYear((y) => y + 1)
                        setCalMonth(0)
                      } else {
                        setCalMonth((m) => m + 1)
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-500/10 cursor-pointer"
                    aria-label="Next Month"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>

                {/* Weekday headers */}
                <div className="grid grid-cols-7 pt-2 text-center text-[11px] font-medium text-stone-400 dark:text-stone-500">
                  {([
                    _('readingData.weekday.0'),
                    _('readingData.weekday.1'),
                    _('readingData.weekday.2'),
                    _('readingData.weekday.3'),
                    _('readingData.weekday.4'),
                    _('readingData.weekday.5'),
                    _('readingData.weekday.6'),
                  ] as string[]).map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>

                {/* Day cells grid */}
                <div className="grid grid-cols-7 gap-1 pt-1">
                  {Array.from({ length: startOffset }, (_, i) => (
                    <span key={`blank-${i}`} />
                  ))}
                  {Array.from({ length: totalDays }, (_, i) => {
                    const d = i + 1
                    const dayStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                    const isSelected = dayStr === date
                    const isToday = dayStr === localDateString()
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setDate(dayStr)
                          setDatePickerOpen(false)
                        }}
                        className={cn(
                          'relative flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium transition-colors cursor-pointer',
                          isSelected
                            ? isReader
                              ? 'bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] font-bold shadow-xs'
                              : 'bg-stone-900 text-white font-bold shadow-xs dark:bg-stone-100 dark:text-stone-900'
                            : isToday
                              ? 'font-bold text-blue-600 dark:text-blue-400 hover:bg-stone-500/10'
                              : 'text-stone-700 hover:bg-stone-500/10 dark:text-stone-200',
                        )}
                      >
                        {d}
                        {isToday && !isSelected && (
                          <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-blue-600 dark:bg-blue-400" />
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Quick actions: 今天 / 昨天 */}
                <div className="mt-2 flex items-center justify-between border-t pt-1.5 px-1 border-stone-200/60 dark:border-stone-800/60 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date()
                      d.setDate(d.getDate() - 1)
                      setDate(localDateString(d))
                      setDatePickerOpen(false)
                    }}
                    className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 cursor-pointer"
                  >
                    {_('readingData.yesterday')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDate(localDateString())
                      setDatePickerOpen(false)
                    }}
                    className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    {_('readingData.today')}
                  </button>
                </div>
              </SmartMenu>
            )}

            {/* 1.2 开始时间 (Defaults to current time directly; no extra click needed) */}
            <div className={cn('mt-3 flex items-center justify-between gap-3 border-t pt-3', dividerCls)}>
              <span className={cn('text-sm font-medium', labelTextCls)}>
                {cleanStartTimeLabel}
              </span>

              {startTime ? (
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    'flex items-center gap-1 rounded-xl border px-2 py-0.5',
                    isReader
                      ? 'border-[var(--bd-read-accent)]/80 bg-transparent'
                      : 'border-stone-200/80 bg-white dark:border-stone-700 dark:bg-stone-800',
                  )}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={startH}
                      placeholder="00"
                      onChange={(e) => handleHourChange(e.target.value)}
                      className={cn(
                        'h-7 w-6 text-center font-mono text-xs font-semibold tabular-nums outline-none bg-transparent',
                        labelTextCls,
                      )}
                    />
                    <span className="font-mono text-xs font-bold text-stone-400 select-none">:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={startM}
                      placeholder="00"
                      onChange={(e) => handleMinuteChange(e.target.value)}
                      className={cn(
                        'h-7 w-6 text-center font-mono text-xs font-semibold tabular-nums outline-none bg-transparent',
                        labelTextCls,
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    title={_('readingData.currentTime')}
                    onClick={() => setStartTime(currentHourMinute())}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title={_('readingData.clearTime')}
                    onClick={() => setStartTime('')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setStartTime(currentHourMinute())}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-xl border border-dashed px-3 text-xs transition-colors cursor-pointer',
                    isReader
                      ? 'border-[var(--bd-read-accent)] text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] hover:border-current'
                      : 'border-stone-300 text-stone-500 hover:border-stone-400 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200',
                  )}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>{_('readingData.recordTime')}</span>
                </button>
              )}
            </div>

            {/* 1.3 阅读时长 (Header cleaned up, no duplicate time text) */}
            <div className={cn('mt-3 border-t pt-3', dividerCls)}>
              <div className="mb-2">
                <span className={cn('text-sm font-medium', labelTextCls)}>
                  {_('reader.addRecordDuration')}
                  <span className="text-red-500"> *</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="relative flex items-center">
                  <input
                    aria-label={_('reader.addRecordHours')}
                    type="number"
                    min={0}
                    max={24}
                    value={hours}
                    onChange={(e) => setHours(Math.max(0, Math.min(24, Number(e.target.value))))}
                    className={cn(inputCls, 'w-full pr-11 text-center font-mono font-medium')}
                  />
                  <span className={cn('pointer-events-none absolute right-3 text-xs select-none', subTextCls)}>
                    {_('reader.addRecordHours')}
                  </span>
                </div>
                <div className="relative flex items-center">
                  <input
                    aria-label={_('reader.addRecordMinutes')}
                    type="number"
                    min={0}
                    max={59}
                    value={minutes}
                    onChange={(e) => setMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
                    className={cn(inputCls, 'w-full pr-11 text-center font-mono font-medium')}
                  />
                  <span className={cn('pointer-events-none absolute right-3 text-xs select-none', subTextCls)}>
                    {_('reader.addRecordMinutes')}
                  </span>
                </div>
              </div>

              {/* 常用时长预设快捷药丸 */}
              <div className="mt-2.5 flex items-center gap-1.5" role="group" aria-label={_('reader.addRecordDuration')}>
                {DURATION_PRESETS.map((m) => {
                  const active = durationSeconds === m * 60
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setHours(Math.floor(m / 60))
                        setMinutes(m % 60)
                      }}
                      className={cn(
                        'flex-1 rounded-lg py-1 text-center text-xs font-medium transition-all cursor-pointer',
                        active
                          ? isReader
                            ? 'bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] font-semibold shadow-xs'
                            : 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : isReader
                            ? 'border border-[var(--bd-read-accent)] bg-transparent text-[var(--bd-read-sub)] hover:text-current hover:border-current'
                            : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700',
                      )}
                    >
                      {m < 60 ? `${m}m` : '1h'}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Card 2: 阅读进度流式卡片 (Progress Flow Card) */}
          <div className={cardCls}>
            <div className="mb-2.5 flex items-center justify-between">
              <span className={cn('text-xs font-medium', subTextCls)}>
                {cleanProgressLabel}
              </span>
              {startPct !== '' && endPct !== '' && Number(endPct) >= Number(startPct) && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold',
                    isReader
                      ? 'bg-[var(--bd-read-accent)]/20 text-[var(--bd-read-text)]'
                      : 'bg-stone-200/80 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
                  )}
                >
                  +{(Number(endPct) - Number(startPct)).toFixed(1)}%
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* 起始进度: 单独显示 % 单位，placeholder 不含重复百分号 */}
              <div className="relative min-w-0 flex-1">
                <input
                  id="addRecordStartPct"
                  aria-label={_('reader.sessionStartPercent')}
                  type="number"
                  min={0}
                  max={maxProgress}
                  disabled={!progressEditable}
                  step="any"
                  placeholder={_('readingData.startPosition')}
                  value={startPct}
                  onChange={(e) => setStartPct(e.target.value)}
                  className={cn(inputCls, 'w-full pr-7 text-center font-mono font-medium')}
                />
                <span className={cn('pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium select-none', subTextCls)}>
                  %
                </span>
              </div>

              {/* 流向指示箭头 */}
              <div className="flex shrink-0 items-center justify-center text-stone-400 dark:text-stone-500" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>

              {/* 结束进度: 单独显示 % 单位，placeholder 不含重复百分号 */}
              <div className="relative min-w-0 flex-1">
                <input
                  id="addRecordEndPct"
                  aria-label={_('reader.sessionEndPercent')}
                  type="number"
                  min={0}
                  max={maxProgress}
                  disabled={!progressEditable}
                  step="any"
                  placeholder={_('readingData.endPosition')}
                  value={endPct}
                  onChange={(e) => setEndPct(e.target.value)}
                  className={cn(inputCls, 'w-full pr-7 text-center font-mono font-medium')}
                />
                <span className={cn('pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium select-none', subTextCls)}>
                  %
                </span>
              </div>
            </div>

            {/* 微型进度条预览 */}
            {startPct !== '' && endPct !== '' && Number(endPct) >= Number(startPct) && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-200/60 dark:bg-stone-800">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    isReader
                      ? 'bg-[var(--bd-read-text)]'
                      : 'bg-stone-900 dark:bg-stone-100',
                  )}
                  style={{
                    marginLeft: `${Math.max(0, Math.min(100, Number(startPct)))}%`,
                    width: `${Math.max(0, Math.min(100, Number(endPct) - Number(startPct)))}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Row 3: 本轮已读完 (Styled as authentic Bookdock Toggle Card) */}
          {!isEditing && <div className={cn(
            'flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-colors',
            isReader
              ? 'border-[var(--bd-read-accent)]/80 bg-transparent'
              : 'border-stone-200/80 bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900/60',
          )}>
            <div className="flex flex-col">
              <span className={cn('text-sm font-medium', labelTextCls)}>
                {_('readingData.markFinished')}
              </span>
            </div>
            <Toggle
              checked={finished}
              onChange={(val) => {
                setFinished(val)
              }}
              ariaLabel={_('readingData.markFinished')}
            />
          </div>}

          {/* 冲突覆盖选项 */}
          {conflicts.length > 0 && (
            <label className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <input
                name="replaceConflicts"
                type="checkbox"
                checked={replaceConflicts}
                onChange={(event) => setReplaceConflicts(event.target.checked)}
                aria-label={_('readingData.replaceConflicts', { n: conflicts.length })}
                className="mt-0.5 h-4 w-4 rounded accent-amber-600 cursor-pointer"
              />
              <span className="flex-1 font-medium leading-relaxed">
                {_('readingData.replaceConflicts', { n: conflicts.length })}
              </span>
            </label>
          )}

          {/* 错误提示 */}
          {error && (
            <div role="alert" className="rounded-xl border border-red-200/80 bg-red-50/80 px-3.5 py-2 text-xs font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* 底部操作按钮 */}
          <div className="flex items-center gap-2.5 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="flex-1 rounded-xl text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            >
              {_('library.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isPending || durationSeconds <= 0 || (conflicts.length > 0 && !replaceConflicts)}
              className="flex-2 rounded-xl shadow-xs"
            >
              {isPending ? `${_('library.save')}...` : _('library.save')}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
