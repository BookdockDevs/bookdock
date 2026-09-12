import { useEffect, useRef } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore } from '@/stores/ui.store'

import { useAutoReadingSession } from '../hooks/useAutoReadingSession'
import type { ReadingMode } from '../types'

interface AutoReadingProgressBarProps {
  readingMode: ReadingMode
}

export default function AutoReadingProgressBar({ readingMode }: AutoReadingProgressBarProps) {
  const _ = useTranslation()
  const enabled = useUiStore((s) => s.autoReadingProgressBar)
  const { state } = useAutoReadingSession()
  const barRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const isSmoothScroll = readingMode === 'scroll' && state.mode === 'smooth'
  const isVisible = enabled && !isSmoothScroll && (state.status === 'running' || state.status === 'paused')

  const { status, stepStartedAt, stepDuration, stepRemaining } = state

  useEffect(() => {
    if (!isVisible || !barRef.current) return

    if (status === 'paused') {
      const fraction = stepDuration && stepRemaining != null
        ? Math.min(1, Math.max(0, (stepDuration - stepRemaining) / stepDuration))
        : 0
      barRef.current.style.transform = `scaleX(${fraction})`
      progressRef.current?.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
      return
    }

    if (status === 'running' && stepStartedAt && stepDuration) {
      let animId: number
      const update = () => {
        const elapsed = Date.now() - stepStartedAt
        const fraction = Math.min(1, Math.max(0, elapsed / Math.max(1, stepDuration)))
        if (barRef.current) {
          barRef.current.style.transform = `scaleX(${fraction})`
        }
        progressRef.current?.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
        if (fraction < 1) {
          animId = requestAnimationFrame(update)
        }
      }
      animId = requestAnimationFrame(update)
      return () => cancelAnimationFrame(animId)
    }

    if (barRef.current) {
      barRef.current.style.transform = 'scaleX(0)'
    }
    progressRef.current?.setAttribute('aria-valuenow', '0')
  }, [isVisible, status, stepStartedAt, stepDuration, stepRemaining])

  if (!isVisible) return null

  return (
    <div
      ref={progressRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[3px] overflow-hidden bg-[var(--bd-read-primary)]/15"
      role="progressbar"
      aria-label={_('reader.autoReadingProgressBar')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
    >
      <div
        ref={barRef}
        className="h-full w-full origin-left bg-[var(--bd-read-primary)] will-change-transform"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  )
}
