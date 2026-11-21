import type { CSSProperties } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { selectEffectiveReadingTheme, useUiStore } from '@/stores/ui.store'

import { useAutoReadingSession } from '../hooks/useAutoReadingSession'
import type { AutoReadingMode, ReadingMode } from '../types'
import { readerPanelVars } from '../lib/reader-panel-vars'
import { ButtonGroup, ControlGroup, PanelSection, PanelSectionList, SliderRow, ToggleRow } from './ReaderPanelPrimitives'

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

interface AutoReadingPanelProps {
  readingMode: ReadingMode
  /** Fired once a start settles, to dismiss the popover and unpin the chrome. */
  onStart?: () => void
}

export default function AutoReadingPanel({ readingMode, onStart }: AutoReadingPanelProps) {
  const _ = useTranslation()
  const { controller, state } = useAutoReadingSession()
  const autoReadingMode = useUiStore((s) => s.autoReadingMode)
  const setAutoReadingMode = useUiStore((s) => s.setAutoReadingMode)
  const autoReadingSpeed = useUiStore((s) => s.autoReadingSpeed)
  const setAutoReadingSpeed = useUiStore((s) => s.setAutoReadingSpeed)
  const autoReadingProgressBar = useUiStore((s) => s.autoReadingProgressBar)
  const setAutoReadingProgressBar = useUiStore((s) => s.setAutoReadingProgressBar)
  const currentTheme = useUiStore(selectEffectiveReadingTheme)
  const sliderVars: CSSProperties = readerPanelVars(currentTheme)
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
      void controller.resume().finally(() => onStart?.())
      return
    }
    void controller.start().finally(() => onStart?.())
  }

  return (
    <div className="flex flex-col" style={sliderVars}>
      <div className="border-b border-[var(--bd-read-accent)]/35 p-4">
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

      <div className="p-4">
        <PanelSectionList>
          <PanelSection>
            {readingMode === 'scroll' && (
              <ControlGroup label={_('reader.autoReadingMode')}>
                <ButtonGroup
                  size="sm"
                  options={[
                    { value: 'smooth', label: _('reader.autoReadingSmooth') },
                    { value: 'timed', label: _('reader.autoReadingTimed') },
                  ]}
                  value={autoReadingMode}
                  onChange={changeMode}
                />
              </ControlGroup>
            )}

            <SliderRow
              label={_('reader.autoReadingSpeed')}
              value={autoReadingSpeed}
              min={1}
              max={100}
              step={1}
              commitOnRelease={false}
              onChange={setAutoReadingSpeed}
            />
          </PanelSection>

          {!(readingMode === 'scroll' && autoReadingMode === 'smooth') && (
            <PanelSection>
              <ToggleRow
                label={_('reader.autoReadingProgressBar')}
                checked={autoReadingProgressBar}
                onChange={setAutoReadingProgressBar}
              />
            </PanelSection>
          )}

          {state.error && (
            <PanelSection>
              <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{_(state.error)}</p>
            </PanelSection>
          )}
        </PanelSectionList>
      </div>
    </div>
  )
}
