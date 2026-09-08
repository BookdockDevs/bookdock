import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format-duration'
import { useTtsSession } from '../hooks/useTtsSession'
import { SettingsPopover } from './SettingsPopover'
import { SettingsPanel } from './SettingsPanel'
import TtsPanel from './TtsPanel'

function TtsActiveIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9h3l5-4v14l-5-4H4V9Z" />
      <path d="M16 9.5a3.5 3.5 0 010 5M18.7 7a7 7 0 010 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  bookId?: string
  onAddBookmark?: () => void
  onToggleSettings?: () => void
  onToggleTts?: () => void
  onToggleFullscreen?: () => void
  bookmarkActive?: boolean
}

export const ReaderHeader = memo(function ReaderHeader({ title, visible, pinned = false, className, estimatedMinutes, settingsOpen, ttsOpen, bookId, onAddBookmark, onToggleSettings, onToggleTts, onToggleFullscreen, bookmarkActive }: ReaderHeaderProps) {
  const _ = useTranslation()
  const { state: ttsState } = useTtsSession()
  const ttsActive = ttsState.status === 'starting' || ttsState.status === 'playing' || ttsState.status === 'paused'
  return (
    <header
      className={cn(
        'pointer-events-none absolute left-0 right-0 top-0 z-40 flex h-12 items-center justify-between border-b border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-2 text-[var(--bd-read-text)] transition-transform duration-300 sm:px-4',
        visible ? 'group-hover:translate-y-0' : '',
        settingsOpen || ttsOpen || pinned ? 'translate-y-0' : '-translate-y-full',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <Link
          to="/"
          aria-label={_('reader.back')}
          className="pointer-events-auto inline-flex items-center text-[var(--bd-read-sub)] hover:text-current"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg className="h-4 w-4" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 6 2 29M12 6l9 23M5 20.5h14" />
                  <path d="M19 7c5 2.8 7 7 7 11M20 2c7 4 11 9.5 11 16" />
                </svg>
              )}
            </button>
            <SettingsPopover open={!!ttsOpen} onClose={() => onToggleTts?.()} toggleSelector="[data-tts-toggle]">
              <TtsPanel />
            </SettingsPopover>
          </div>
        )}
        {onAddBookmark && (
          <button
            onClick={onAddBookmark}
            title="添加书签"
            className={cn(
              'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg border bg-transparent transition-colors sm:h-8 sm:w-8',
              bookmarkActive
                ? 'border-current text-current'
                : 'border-[var(--bd-read-accent)] text-[var(--bd-read-sub)] hover:bg-stone-500/10',
            )}
          >
            {bookmarkActive ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M6 2h12a2 2 0 012 2v18l-8-4-8 4V4a2 2 0 012-2z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 4h12v16l-6-3-6 3V4z" />
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
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
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
