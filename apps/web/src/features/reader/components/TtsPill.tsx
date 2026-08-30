import { memo } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { useTtsSession } from '../hooks/useTtsSession'
import type { TtsController, TtsStatus } from '../lib/tts-controller'

interface TtsPillProps {
  inline?: boolean
}

function PreviousIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 5v14h2V5H5Zm14 1.7L9.5 12l9.5 5.3V6.7Z" />
    </svg>
  )
}

function NextIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 5v14h2V5h-2ZM5 6.7 14.5 12 5 17.3V6.7Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

const actionButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-[var(--bd-read-text)] disabled:pointer-events-none disabled:opacity-35'

interface TtsPillViewProps {
  controller: TtsController
  inline: boolean
  status: TtsStatus
}

const TtsPillView = memo(function TtsPillView({ controller, inline, status }: TtsPillViewProps) {
  const _ = useTranslation()

  return (
    <div className={cn('pointer-events-auto z-[60]', inline ? 'relative' : 'absolute bottom-14 right-3')}>
      <div className="flex h-11 items-center gap-0.5 rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-1.5 shadow-xl">
        <button
          type="button"
          onClick={() => void controller.previous()}
          disabled={status === 'starting'}
          title={_('reader.ttsPrevious')}
          aria-label={_('reader.ttsPrevious')}
          className={cn(actionButton)}
        >
          <PreviousIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            if (status === 'playing') void controller.pause()
            else if (status === 'paused') void controller.resume()
          }}
          disabled={status === 'starting'}
          title={status === 'paused' ? _('reader.ttsResume') : _('reader.ttsPause')}
          aria-label={status === 'paused' ? _('reader.ttsResume') : _('reader.ttsPause')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-50"
        >
          {status === 'paused' ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          onClick={() => void controller.next()}
          disabled={status === 'starting'}
          title={_('reader.ttsNext')}
          aria-label={_('reader.ttsNext')}
          className={cn(actionButton)}
        >
          <NextIcon />
        </button>
        <button
          type="button"
          onClick={() => void controller.stop()}
          title={_('reader.ttsStop')}
          aria-label={_('reader.ttsStop')}
          className={cn(actionButton)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
})

export default function TtsPill({ inline = false }: TtsPillProps) {
  const { controller, state } = useTtsSession()
  const active = state.status === 'starting' || state.status === 'playing' || state.status === 'paused'

  if (!active || !controller) return null
  return <TtsPillView controller={controller} inline={inline} status={state.status} />
}
