import { useState } from 'react'

import type { ReadingDetailManualItem, ReadingSessionUpdateReq } from '@bookdock/shared'

import { localDateString } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

interface SessionEditRowProps {
  session: ReadingDetailManualItem
  onCancel: () => void
  onSave: (body: ReadingSessionUpdateReq) => void
}

/**
 * Inline edit form for a manual session row: duration, start/end times and
 * start/end percent (chapter bounds and CFI stay untouched). Retroactive
 * entries (null startedAt) have no times to edit, so the time fields are
 * hidden and the save body omits them.
 */
export default function SessionEditRow({ session, onCancel, onSave }: SessionEditRowProps) {
  const _ = useTranslation()
  const retro = session.startedAt === null
  const [durationMin, setDurationMin] = useState(Math.max(1, Math.round(session.durationSeconds / 60)))
  const [startInput, setStartInput] = useState(toLocalInput(session.startedAt ?? session.endedAt ?? Date.now()))
  const [endInput, setEndInput] = useState(toLocalInput(session.endedAt ?? session.startedAt ?? Date.now()))
  const [startPct, setStartPct] = useState(session.startFraction !== null ? Math.round(session.startFraction * 100) : 0)
  const [endPct, setEndPct] = useState(session.endFraction !== null ? Math.round(session.endFraction * 100) : 0)

  const inputCls =
    'w-full rounded-md border border-stone-200 bg-transparent px-1.5 py-1 text-xs outline-none dark:border-stone-800'

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-2 text-[var(--bd-read-sub)]">
        <span>{_('reader.sessionDuration')}</span>
        <input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className={cn(inputCls, 'w-20')} />
      </label>
      {!retro && (
        <>
          <label className="flex items-center justify-between gap-2 text-[var(--bd-read-sub)]">
            <span>{_('reader.sessionStartTime')}</span>
            <input type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center justify-between gap-2 text-[var(--bd-read-sub)]">
            <span>{_('reader.sessionEndTime')}</span>
            <input type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} className={inputCls} />
          </label>
        </>
      )}
      <label className="flex items-center justify-between gap-2 text-[var(--bd-read-sub)]">
        <span>{_('reader.sessionStartPercent')}</span>
        <input type="number" min={0} max={100} value={startPct} onChange={(e) => setStartPct(Number(e.target.value))} className={cn(inputCls, 'w-20')} />
      </label>
      <label className="flex items-center justify-between gap-2 text-[var(--bd-read-sub)]">
        <span>{_('reader.sessionEndPercent')}</span>
        <input type="number" min={0} max={100} value={endPct} onChange={(e) => setEndPct(Number(e.target.value))} className={cn(inputCls, 'w-20')} />
      </label>
      <p className="text-[10px] text-[var(--bd-read-sub)]">{_('reader.sessionEditHint')}</p>
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <button onClick={onCancel} className="rounded-md px-2 py-1 text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10">
          {_('reader.sessionCancel')}
        </button>
        <button
          onClick={() => {
            const body: ReadingSessionUpdateReq = {
              durationSeconds: Math.max(1, durationMin) * 60,
              startFraction: Math.min(100, Math.max(0, startPct)) / 100,
              endFraction: Math.min(100, Math.max(0, endPct)) / 100,
            }
            if (!retro) {
              const startedAt = new Date(startInput).getTime()
              const endedAt = new Date(endInput).getTime()
              if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return
              body.startedAt = startedAt
              body.endedAt = endedAt
              body.date = localDateString(new Date(startedAt))
            }
            onSave(body)
          }}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-white transition-colors hover:bg-blue-700"
        >
          {_('reader.sessionSave')}
        </button>
      </div>
    </div>
  )
}
