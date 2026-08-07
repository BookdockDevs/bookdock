import { useEffect, useRef, useState } from 'react'

import { useToastStore } from '@/stores/toast.store'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useManualTimer } from '../hooks/useManualTimer'

interface TimerPillProps {
  bookId: string
}

const LONG_PRESS_MS = 600

const RING_RADIUS = 11
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function StopwatchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
    </svg>
  )
}

function PauseIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

interface StopHoldButtonProps {
  title: string
  onTerminate: () => void
  onDiscard: () => void
}

/**
 * Terminate button with the Pill v2 long-press discard: a tap (release before
 * 600ms) terminates and saves the session; holding for 600ms sweeps a red
 * ring around the button and discards the session without saving.
 */
function StopHoldButton({ title, onTerminate, onDiscard }: StopHoldButtonProps) {
  const pressTimerRef = useRef<number | null>(null)
  const [pressing, setPressing] = useState(false)

  useEffect(() => () => {
    if (pressTimerRef.current !== null) window.clearTimeout(pressTimerRef.current)
  }, [])

  const cancelPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    setPressing(false)
  }

  return (
    <button
      onPointerDown={() => {
        setPressing(true)
        pressTimerRef.current = window.setTimeout(() => {
          pressTimerRef.current = null
          setPressing(false)
          onDiscard()
        }, LONG_PRESS_MS)
      }}
      onPointerUp={() => {
        // Released before the long-press threshold: a normal tap saves
        if (pressTimerRef.current !== null) {
          cancelPress()
          onTerminate()
        }
      }}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      title={title}
      className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-red-500/10 hover:text-red-500"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full -rotate-90 text-red-500"
      >
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={pressing ? 0 : RING_CIRCUMFERENCE}
          className="transition-[stroke-dashoffset] duration-[600ms] ease-linear"
        />
      </svg>
      <span className="relative">
        <StopIcon />
      </span>
    </button>
  )
}

const actionBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]'

/**
 * Manual reading timer pill (manual-reading-timer.md §2 v2), bottom-right
 * floating. Idle = single round button; running = icon-less time capsule,
 * as small as possible, with pause/stop sliding out on hover / focus / tap
 * (max-w transition, tap toggles as the touch fallback); suspended = grace
 * countdown with resume/stop. Stop = save; long-press = discard.
 */
export default function TimerPill({ bookId }: TimerPillProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const timer = useManualTimer(bookId)
  const { phase, elapsedMs, graceMs, lastSummary, clearSummary, start, pause, resume, terminate, discard } = timer
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!lastSummary) return
    addToast(_('reader.manualTimerSummary', { duration: formatDuration(lastSummary.durationSeconds * 1000) }), 'success')
    clearSummary()
  }, [lastSummary, addToast, clearSummary, _])

  if (phase === 'idle') {
    return (
      <div className="pointer-events-auto absolute bottom-3 right-3 z-[60]">
        <button
          onClick={() => start()}
          title={_('reader.manualTimerStart')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] text-[var(--bd-read-sub)] shadow-xl transition-colors hover:text-[var(--bd-read-text)]"
        >
          <StopwatchIcon />
        </button>
      </div>
    )
  }

  const stopButton = (
    <StopHoldButton
      title={_('reader.manualTimerTerminate')}
      onTerminate={terminate}
      onDiscard={() => {
        discard()
        addToast(_('reader.manualTimerDiscarded'), 'info')
      }}
    />
  )

  if (phase === 'running') {
    return (
      <div className="pointer-events-auto absolute bottom-3 right-3 z-[60]">
        <div
          className={cn(
            'group flex h-9 items-center rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl',
            expanded ? 'pl-2.5 pr-0.5' : 'px-2.5',
          )}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            title={expanded ? undefined : _('reader.manualTimerPause')}
            className="flex h-full items-center text-sm tabular-nums text-[var(--bd-read-text)]"
          >
            {formatDuration(elapsedMs)}
          </button>
          <div
            className={cn(
              'flex items-center gap-0.5 overflow-hidden transition-all duration-200',
              expanded
                ? 'ml-1 max-w-24'
                : 'max-w-0 group-hover:max-w-24 group-focus-within:max-w-24',
            )}
          >
            <button onClick={pause} title={_('reader.manualTimerPause')} className={actionBtn}>
              <PauseIcon />
            </button>
            {stopButton}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-[60]">
      <div
        className={cn(
          'group flex h-11 items-center rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] pl-3 shadow-xl',
          expanded ? 'pr-1' : 'pr-3',
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex h-full items-center text-[var(--bd-read-sub)]"
        >
          <span className="min-w-[3.25rem] text-right text-sm tabular-nums text-[var(--bd-read-sub)]">
            {phase === 'suspended'
              ? _('reader.manualTimerRemaining', { duration: formatDuration(graceMs) })
              : formatDuration(elapsedMs)}
          </span>
        </button>
        <div
          className={cn(
            'flex items-center gap-0.5 overflow-hidden transition-all duration-200',
            expanded
              ? 'ml-1 max-w-24'
              : 'max-w-0 group-hover:max-w-24 group-focus-within:max-w-24',
          )}
        >
          <button onClick={resume} title={_('reader.manualTimerResume')} className={actionBtn}>
            <PlayIcon />
          </button>
          {stopButton}
        </div>
      </div>
    </div>
  )
}
