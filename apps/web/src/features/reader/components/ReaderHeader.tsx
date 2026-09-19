import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useBackNavigation } from '@/hooks/useBackNavigation'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format-duration'
import { useAutoReadingSession } from '../hooks/useAutoReadingSession'
import { useTtsSession } from '../hooks/useTtsSession'
import { SettingsPopover } from './SettingsPopover'
import { SettingsPanel } from './SettingsPanel'
import TtsPanel from './TtsPanel'
import AutoReadingPanel from './AutoReadingPanel'
import { TtsIcon } from './annotation-icons'

// Header icons share one optical baseline: the glyph renders ~12x12px inside the
// 16px canvas, with a ~1px stroke. Wide shapes (speaker, auto-reading) trade
// height for width. The TTS glyphs are scaled with a tighter viewBox instead of
// being redrawn, so their original shapes stay untouched — but a tighter viewBox
// also magnifies the stroke, so their strokeWidth is divided by the same factor
// to keep the rendered weight at 1px.
function TtsActiveIcon() {
  return (
    <svg className="h-4 w-4" viewBox="1.8 3.15 21.2 17.7" fill="currentColor" aria-hidden="true">
      <path d="M4 9h3l5-4v14l-5-4H4V9Z" />
      <path d="M16 9.5a3.5 3.5 0 010 5M18.7 7a7 7 0 010 10" fill="none" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" />
    </svg>
  )
}

function AutoReadingIcon({ status }: { status: 'idle' | 'running' | 'paused' }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M 2.82 5.71 H 9.89 L 16.46 3.78 V 20.27 C 15.47 20.02 10.88 18.76 9.98 18.51 H 2.82 Z" />
      <path d="M 17.21 5.71 H 21.18 V 18.51 H 17.21" />
      {status === 'running' && <path d="M 12.8 12 H 6.8 M 9.3 9.5 L 6.8 12 L 9.3 14.5" />}
      {status === 'paused' && <path d="M 8.19 8.9 V 15.1 M 12.15 8.9 V 15.1" />}
    </svg>
  )
}

interface ReaderHeaderProps {
  title: string
  visible: boolean
  /** Middle click-area tap forces the header down (mobile: no hover) */
  pinned?: boolean
  className?: string
  estimatedMinutes?: number
  settingsOpen?: boolean
  ttsOpen?: boolean
  autoReadingOpen?: boolean
  readingMode?: 'scroll' | 'page'
  bookId?: string
  onAddBookmark?: () => void
  onToggleSettings?: () => void
  onToggleTts?: () => void
  onToggleAutoReading?: () => void
  onToggleFullscreen?: () => void
  bookmarkActive?: boolean
}

export const ReaderHeader = memo(function ReaderHeader({ title, visible, pinned = false, className, estimatedMinutes, settingsOpen, ttsOpen, autoReadingOpen, readingMode = 'scroll', bookId, onAddBookmark, onToggleSettings, onToggleTts, onToggleAutoReading, onToggleFullscreen, bookmarkActive }: ReaderHeaderProps) {
  const _ = useTranslation()
  const onBack = useBackNavigation('/')
  const { state: ttsState } = useTtsSession()
  const { state: autoReadingState } = useAutoReadingSession()
  const ttsActive = ttsState.status === 'starting' || ttsState.status === 'playing' || ttsState.status === 'paused'
  return (
    <header
      className={cn(
        'pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-12 items-center justify-between border-b border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-2 text-[var(--bd-read-text)] transition-transform duration-300 sm:px-3',
        visible ? 'group-hover:translate-y-0' : '',
        settingsOpen || ttsOpen || autoReadingOpen || pinned ? 'translate-y-0' : '-translate-y-full',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
        <Link
          to="/"
          onClick={onBack}
          aria-label={_('reader.back')}
          className="pointer-events-auto -ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
        >
          <svg width="18" height="18" viewBox="1.5 1.5 21 21" fill="none" stroke="currentColor" strokeWidth="1.17" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-medium md:max-w-md">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {estimatedMinutes !== undefined && (
          <span className="mr-1 hidden text-xs tabular-nums text-[var(--bd-read-sub)] sm:mr-2 sm:inline">
            {formatDuration(estimatedMinutes * 60, _)}
          </span>
        )}
        {onToggleTts && (
          <div className="relative">
            <button
              data-tts-toggle
              onClick={onToggleTts}
              title={_('reader.ttsTitle')}
              aria-label={_('reader.ttsTitle')}
              aria-pressed={ttsActive || !!ttsOpen}
              className={cn(
                'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border transition-colors hover:bg-stone-500/10 sm:h-8 sm:w-8',
                ttsActive
                  ? 'border-current text-current'
                  : 'text-[var(--bd-read-text)]',
                !ttsActive && ttsOpen && 'bg-stone-500/10',
              )}
              style={ttsActive ? undefined : { borderColor: 'var(--bd-read-accent)' }}
            >
              {ttsActive ? <TtsActiveIcon /> : (
                <TtsIcon className="h-4 w-4" viewBox="1.7 2.4 20.6 19.2" strokeWidth={1.29} />
              )}
            </button>
            <SettingsPopover open={!!ttsOpen} onClose={() => onToggleTts?.()} toggleSelector="[data-tts-toggle]">
              <TtsPanel />
            </SettingsPopover>
          </div>
        )}
        {onToggleAutoReading && (
          <div className="relative">
            <button
              data-auto-reading-toggle
              onClick={onToggleAutoReading}
              title={_('reader.autoReadingTitle')}
              aria-label={_('reader.autoReadingTitle')}
              aria-pressed={autoReadingState.status !== 'idle' || !!autoReadingOpen}
              className={cn(
                'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border transition-colors hover:bg-stone-500/10 sm:h-8 sm:w-8',
                autoReadingState.status !== 'idle' ? 'border-current text-current' : 'text-[var(--bd-read-text)]',
                autoReadingState.status === 'idle' && autoReadingOpen && 'bg-stone-500/10',
              )}
              style={autoReadingState.status === 'idle' ? { borderColor: 'var(--bd-read-accent)' } : undefined}
            >
              <AutoReadingIcon status={autoReadingState.status} />
            </button>
            <SettingsPopover open={!!autoReadingOpen} onClose={() => onToggleAutoReading?.()} toggleSelector="[data-auto-reading-toggle]">
              <AutoReadingPanel readingMode={readingMode} onClose={() => onToggleAutoReading?.()} />
            </SettingsPopover>
          </div>
        )}
        {onAddBookmark && (
          <button
            onClick={onAddBookmark}
            title={bookmarkActive ? '移除书签' : '添加书签'}
            aria-label={bookmarkActive ? '移除书签' : '添加书签'}
            aria-pressed={bookmarkActive}
            className={cn(
              'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border bg-transparent transition-colors hover:bg-stone-500/10 sm:h-8 sm:w-8',
              bookmarkActive
                ? 'border-current text-current'
                : 'border-[var(--bd-read-accent)] text-[var(--bd-read-text)]',
            )}
          >
            {bookmarkActive ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M7 3h10a2 2 0 0 1 2 2v16l-7-3.5-7 3.5V5a2 2 0 0 1 2-2z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3h14v18l-7-3.5-7 3.5V3z" />
              </svg>
            )}
          </button>
        )}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            title="全屏"
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 sm:h-8 sm:w-8"
            style={{ borderColor: 'var(--bd-read-accent)' }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </button>
        )}
        {onToggleSettings && (
          <div className="relative">
            <button
              data-settings-toggle
              onClick={onToggleSettings}
              title="设置"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border text-[var(--bd-read-text)] transition-colors hover:bg-stone-500/10 sm:h-8 sm:w-8"
              style={{ borderColor: 'var(--bd-read-accent)' }}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {/* Lucide's gear spans 1-23; shrink it to the 18x18 baseline
                    and widen the stroke so the rendered weight stays 1.5 */}
                <g transform="translate(2.18 2.18) scale(0.818)" strokeWidth="1.83">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </g>
              </svg>
            </button>
            <SettingsPopover open={!!settingsOpen} onClose={() => onToggleSettings?.()}>
              <SettingsPanel bookId={bookId ?? ''} />
            </SettingsPopover>
          </div>
        )}
      </div>
    </header>
  )
})
