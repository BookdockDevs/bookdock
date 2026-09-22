import type { CSSProperties } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { blendColors, cn } from '@/lib/utils'
import { resolveReadingTheme } from '@/lib/reading-theme'
import { selectEffectiveReadingThemeId, useUiStore } from '@/stores/ui.store'

import { useAutoReadingSession } from '../hooks/useAutoReadingSession'
import type { AutoReadingMode, ReadingMode } from '../types'

function PlayIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

interface ReaderToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ReaderToggle({ label, checked, onChange }: ReaderToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--bd-read-sub)]">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--toggle-on-bg)' : 'var(--toggle-off-bg)' }}
        aria-checked={checked}
        aria-label={label}
        role="switch"
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] transition-transform',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

interface AutoReadingPanelProps {
  readingMode: ReadingMode
  onClose: () => void
}

export default function AutoReadingPanel({ readingMode, onClose }: AutoReadingPanelProps) {
  const _ = useTranslation()
  const { controller, state } = useAutoReadingSession()
  const autoReadingMode = useUiStore((s) => s.autoReadingMode)
  const setAutoReadingMode = useUiStore((s) => s.setAutoReadingMode)
  const autoReadingSpeed = useUiStore((s) => s.autoReadingSpeed)
  const setAutoReadingSpeed = useUiStore((s) => s.setAutoReadingSpeed)
  const autoReadingProgressBar = useUiStore((s) => s.autoReadingProgressBar)
  const setAutoReadingProgressBar = useUiStore((s) => s.setAutoReadingProgressBar)
  const readingThemeId = useUiStore(selectEffectiveReadingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const currentTheme = resolveReadingTheme(readingThemeId, customThemes)
  const sliderVars = {
    '--slider-accent': blendColors(currentTheme.bg, currentTheme.text, 0.55),
    '--slider-track': blendColors(currentTheme.bg, currentTheme.text, 0.15),
    '--toggle-on-bg': blendColors(currentTheme.bg, currentTheme.text, 0.55),
    '--toggle-off-bg': blendColors(currentTheme.bg, currentTheme.text, 0.15),
  } as CSSProperties
  const active = state.status === 'running' || state.status === 'paused'

  function changeMode(mode: AutoReadingMode) {
    if (readingMode === 'scroll' && mode !== autoReadingMode) setAutoReadingMode(mode)
  }

  function handlePrimaryAction() {
    if (!controller) return
    if (state.status === 'running') {
      void controller.pause()
      return
    }
    if (state.status === 'paused') {
      void controller.resume()
      return
    }
    void controller.start().finally(onClose)
  }

  return (
    <div className="flex flex-col" style={sliderVars}>
      <div className="border-b border-[var(--bd-read-accent)] p-4">
        <div className="flex w-full">
          <button
            type="button"
            disabled={!controller}
            onClick={handlePrimaryAction}
            className={cn(
              'flex h-10 min-w-0 flex-1 items-center justify-center gap-2 bg-[var(--bd-read-text)] px-3 text-sm font-medium text-[var(--bd-read-bg)] transition-opacity hover:opacity-85 disabled:opacity-50',
              active ? 'rounded-l-lg' : 'rounded-lg',
            )}
          >
            {state.status === 'running' ? <PauseIcon /> : <PlayIcon />}
            {state.status === 'running' ? _('reader.autoReadingPause') : state.status === 'paused' ? _('reader.autoReadingResume') : _('reader.autoReadingStart')}
          </button>
          {active && (
            <button
              type="button"
              onClick={() => void controller?.stop()}
              title={_('reader.autoReadingStop')}
              aria-label={_('reader.autoReadingStop')}
              className="flex h-10 w-11 shrink-0 items-center justify-center rounded-r-lg border-l border-[var(--bd-read-bg)]/30 bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] transition-opacity hover:opacity-85"
            >
              <StopIcon />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {readingMode === 'scroll' && (
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="text-[var(--bd-read-sub)]">{_('reader.autoReadingMode')}</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--bd-read-accent)] p-1">
              {(['smooth', 'timed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={autoReadingMode === mode}
                  onClick={() => changeMode(mode)}
                  className={cn(
                    'h-8 rounded-md px-2 text-sm transition-colors',
                    autoReadingMode === mode ? 'bg-stone-500/15 text-current' : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10',
                  )}
                >
                  {mode === 'smooth' ? _('reader.autoReadingSmooth') : _('reader.autoReadingTimed')}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-[var(--bd-read-sub)]">{_('reader.autoReadingSpeed')}</span>
            <span className="tabular-nums">{autoReadingSpeed}</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={autoReadingSpeed}
            onChange={(event) => setAutoReadingSpeed(Number(event.target.value))}
            aria-label={_('reader.autoReadingSpeed')}
            className="bd-slider w-full"
            style={{ '--slider-fill': `${autoReadingSpeed}%` } as CSSProperties}
          />
        </div>
        {!(readingMode === 'scroll' && autoReadingMode === 'smooth') && (
          <div className="border-t border-[var(--bd-read-accent)] pt-3">
            <ReaderToggle
              label={_('reader.autoReadingProgressBar')}
              checked={autoReadingProgressBar}
              onChange={setAutoReadingProgressBar}
            />
          </div>
        )}
        {state.error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{_(state.error)}</p>}
      </div>
    </div>
  )
}
