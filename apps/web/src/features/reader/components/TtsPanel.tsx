import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { useTtsServices } from '@/api/hooks/useTts'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { blendColors, cn } from '@/lib/utils'
import { resolveReadingTheme } from '@/lib/reading-theme'
import { useUiStore } from '@/stores/ui.store'

import { useReaderApi } from '../hooks/useReaderApi'
import { useTtsSession } from '../hooks/useTtsSession'
import { useReaderState } from '../state/reader-state'
import { SelectedPositionIcon } from './annotation-icons'

function PlayIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
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

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 15 6-6 6 6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

function ChapterStartIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h11M21 6.5l-3 1.5 3 1.5M4 12h17M4 16h17" />
    </svg>
  )
}

interface ReaderSelectOption {
  value: string
  label: string
}

interface ReaderSelectProps {
  label: string
  value: string
  options: ReaderSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

function ReaderSelect({ label, value, options, onChange, disabled = false }: ReaderSelectProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  useDismissiblePopup(open, ref, () => setOpen(false))

  return (
    <div ref={ref} className="flex flex-col gap-1.5 text-xs">
      <span className="text-[var(--bd-read-sub)]">{label}</span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          title={selected?.label ?? value}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-[var(--bd-read-accent)] bg-transparent px-3 text-left text-sm outline-none transition-colors hover:bg-stone-500/5 focus:border-current disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label ?? value}</span>
          <span className="ml-3 shrink-0 text-[var(--bd-read-sub)] transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
            <ChevronDownIcon />
          </span>
        </button>
        {open && !disabled && (
          <div role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-1 shadow-xl">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                title={option.label}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex h-9 min-w-0 w-full items-center overflow-hidden rounded-md px-2.5 text-left text-sm transition-colors hover:bg-stone-500/10',
                  option.value === value && 'bg-stone-500/10',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && <span className="ml-2 shrink-0 text-[var(--tts-active)]"><CheckIcon /></span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface ReaderToggleProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ReaderToggle({ label, hint, checked, onChange }: ReaderToggleProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="text-sm text-current">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-[var(--bd-read-sub)]">{hint}</div>}
      </div>
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

export default function TtsPanel() {
  const _ = useTranslation()
  const { controller, state } = useTtsSession()
  const { renderer } = useReaderApi()
  const selection = useReaderState((s) => s.selection)
  const setSelection = useReaderState((s) => s.setSelection)
  const [menuOpen, setMenuOpen] = useState(false)
  const startMenuRef = useRef<HTMLDivElement>(null)
  const servicesQuery = useTtsServices()
  const { data: servicesData } = servicesQuery
  const services = servicesData?.data ?? []
  const ttsEngine = useUiStore((s) => s.ttsEngine)
  const ttsServiceId = useUiStore((s) => s.ttsServiceId)
  const setTtsEngine = useUiStore((s) => s.setTtsEngine)
  const setTtsServiceId = useUiStore((s) => s.setTtsServiceId)
  const ttsRate = useUiStore((s) => s.ttsRate)
  const setTtsRate = useUiStore((s) => s.setTtsRate)
  const ttsVoiceId = useUiStore((s) => s.ttsVoiceId)
  const setTtsVoiceId = useUiStore((s) => s.setTtsVoiceId)
  const ttsAutoNext = useUiStore((s) => s.ttsAutoNext)
  const setTtsAutoNext = useUiStore((s) => s.setTtsAutoNext)
  const setTtsFollow = useUiStore((s) => s.setTtsFollow)
  const readingThemeId = useUiStore((s) => s.readingThemeId)
  const customThemes = useUiStore((s) => s.customThemes)
  const active = state.status === 'playing' || state.status === 'starting' || state.status === 'paused'
  const selectedEngine = ttsEngine === 'service' && ttsServiceId && services.some((service) => service.id === ttsServiceId)
    ? `service:${ttsServiceId}`
    : ttsEngine === 'edge' ? 'edge' : 'system'
  const currentTheme = useMemo(() => resolveReadingTheme(readingThemeId, customThemes), [customThemes, readingThemeId])
  const sliderVars = useMemo(() => ({
    '--slider-accent': blendColors(currentTheme.bg, currentTheme.text, 0.55),
    '--slider-track': blendColors(currentTheme.bg, currentTheme.text, 0.15),
    '--toggle-on-bg': blendColors(currentTheme.bg, currentTheme.text, 0.55),
    '--toggle-off-bg': blendColors(currentTheme.bg, currentTheme.text, 0.10),
    '--tts-active': currentTheme.primary,
  }) as React.CSSProperties, [currentTheme])
  const ratePercent = Math.round(((ttsRate - 0.5) / 2.5) * 100)
  useDismissiblePopup(menuOpen, startMenuRef, () => setMenuOpen(false))

  function changeEngine(value: string) {
    if (value === 'system' || value === 'edge') {
      setTtsEngine(value)
      setTtsServiceId(null)
      setTtsVoiceId('')
      return
    }
    const serviceId = value.replace(/^service:/, '')
    const service = services.find((item) => item.id === serviceId)
    if (!service) return
    setTtsEngine('service')
    setTtsServiceId(service.id)
    setTtsVoiceId(service.defaultVoice ?? '')
  }

  function handlePrimaryAction() {
    setMenuOpen(false)
    if (active) {
      void controller?.stop()
      return
    }
    void controller?.start()
  }

  function startFromChapter() {
    setMenuOpen(false)
    void controller?.startFromChapter()
  }

  function startFromSelection() {
    const cfiRange = selection?.cfiRange
    if (!cfiRange || !controller) return
    setMenuOpen(false)
    renderer?.clearSelection()
    setSelection(null)
    void controller.start(cfiRange)
  }

  return (
    <div className="flex flex-col" style={sliderVars}>
      <style>{`\n.bd-slider {\n  -webkit-appearance: none;\n  appearance: none;\n  background: transparent;\n  cursor: pointer;\n  display: block;\n  width: 100%;\n  height: 20px;\n}\n.bd-slider::-webkit-slider-runnable-track {\n  height: 6px;\n  border-radius: 3px;\n  background: linear-gradient(to right, var(--slider-accent) 0%, var(--slider-accent) var(--slider-fill, 50%), var(--slider-track) var(--slider-fill, 50%), var(--slider-track) 100%);\n}\n.bd-slider::-webkit-slider-thumb {\n  -webkit-appearance: none;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  background: var(--slider-accent);\n  margin-top: -5px;\n}\n.bd-slider::-moz-range-track {\n  height: 6px;\n  border-radius: 3px;\n  background: linear-gradient(to right, var(--slider-accent) 0%, var(--slider-accent) var(--slider-fill, 50%), var(--slider-track) var(--slider-fill, 50%), var(--slider-track) 100%);\n  border: none;\n}\n.bd-slider::-moz-range-thumb {\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  background: var(--slider-accent);\n  border: none;\n}\n.bd-slider:focus-visible {\n  outline: 2px solid var(--slider-accent);\n  outline-offset: 2px;\n}\n`}</style>
      <div className="border-b border-[var(--bd-read-accent)] p-4">
        <div ref={startMenuRef} className="relative flex w-full">
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={!controller}
            className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-l-lg bg-[var(--bd-read-text)] px-3 text-sm font-medium text-[var(--bd-read-bg)] transition-opacity disabled:opacity-50"
          >
            {active ? <StopIcon /> : <PlayIcon />}
            {active ? _('reader.ttsStop') : _('reader.ttsPlay')}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={_('reader.ttsStartOptions')}
            className="flex h-10 w-11 shrink-0 items-center justify-center rounded-r-lg border-l border-[var(--bd-read-bg)]/30 bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] transition-opacity hover:opacity-85"
          >
            {menuOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
          {menuOpen && (
            <div role="menu" className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-lg border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] shadow-xl">
              <button
                type="button"
                role="menuitem"
                onClick={startFromChapter}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-stone-500/10"
              >
                <span className="flex w-5 justify-center text-[var(--bd-read-sub)]"><ChapterStartIcon /></span>
                <span>{_('reader.ttsFromChapterStart')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!selection || !controller}
                onClick={startFromSelection}
                className={cn(
                  'flex w-full items-center gap-3 border-t border-[var(--bd-read-accent)] px-4 py-3 text-left text-sm transition-colors hover:bg-stone-500/10',
                  selection && controller
                    ? 'text-current'
                    : 'cursor-not-allowed text-[var(--bd-read-sub)] opacity-40',
                )}
              >
                <span className={cn('flex w-5 justify-center', selection && controller ? 'text-current' : 'text-[var(--bd-read-sub)]')}><SelectedPositionIcon /></span>
                <span>{_('reader.ttsFromSelectedPosition')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {servicesQuery.isError && (
          <QueryErrorState className="py-2" isRetrying={servicesQuery.isFetching} onRetry={servicesQuery.refetch} />
        )}
        <ReaderSelect
          label={_('reader.ttsEngine')}
          value={selectedEngine}
          onChange={changeEngine}
          options={[
            { value: 'system', label: _('reader.ttsSystem') },
            { value: 'edge', label: 'Edge TTS' },
            ...services.map((service) => ({ value: `service:${service.id}`, label: service.name })),
          ]}
        />

        <ReaderSelect
          label={_('reader.ttsVoice')}
          value={ttsVoiceId}
          onChange={setTtsVoiceId}
          options={[
            { value: '', label: _('reader.ttsVoiceDefault') },
            ...state.voices.map((voice) => ({ value: voice.id, label: `${voice.name}${voice.lang ? ` (${voice.lang})` : ''}` })),
          ]}
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-[var(--bd-read-sub)]">{_('reader.ttsRate')}</span>
            <span className="tabular-nums">{ttsRate.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={ttsRate}
            onChange={(event) => setTtsRate(Number(event.target.value))}
            className="bd-slider w-full"
            style={{ '--slider-fill': `${ratePercent}%` } as React.CSSProperties}
          />
        </div>

        <div className="border-t border-[var(--bd-read-accent)] pt-2">
          <ReaderToggle
            label={_('reader.ttsAutoNext')}
            hint={_('reader.ttsAutoNextHint')}
            checked={ttsAutoNext}
            onChange={setTtsAutoNext}
          />
          <ReaderToggle
            label={_('reader.ttsFollow')}
            hint={_('reader.ttsFollowHint')}
            checked={state.highlighting}
            onChange={(checked) => {
              setTtsFollow(checked)
              controller?.setHighlighting(checked)
            }}
          />
        </div>

        <div className="-mt-6 flex justify-end">
          <Link
            to="/settings"
            search={{ section: 'reading', focus: 'tts' }}
            className="text-xs text-[var(--bd-read-sub)] underline underline-offset-2 transition-colors hover:text-current"
          >
            {_('reader.ttsManageServices')}
          </Link>
        </div>
        {state.error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{_('reader.ttsPlaybackFailed')}</p>}
      </div>
    </div>
  )
}
