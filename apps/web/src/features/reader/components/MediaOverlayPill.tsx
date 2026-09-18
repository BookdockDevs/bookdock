import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { useReaderApi } from '../hooks/useReaderApi'
import { useReaderState } from '../state/reader-state'
import type { ReaderPlaybackCoordinator } from '../lib/playback-coordinator'
import { findCueIndexForTime, type MediaOverlayCue } from '../lib/media-overlay'

interface MediaOverlayPillProps {
  coordinator: ReaderPlaybackCoordinator
  inline?: boolean
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function HeadphoneIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  )
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

export const MediaOverlayPill = memo(function MediaOverlayPill({ coordinator, inline = false }: MediaOverlayPillProps) {
  const _ = useTranslation()
  const { renderer } = useReaderApi()
  const currentChapterIndex = useReaderState((s) => s.currentChapterIndex)

  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [activeSection, setActiveSection] = useState<number | null>(null)
  const [cueIndex, setCueIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const activeHrefRef = useRef<string | null>(null)
  const cuesRef = useRef<MediaOverlayCue[]>([])
  const statusRef = useRef(status)
  statusRef.current = status
  const cueIndexRef = useRef(cueIndex)
  cueIndexRef.current = cueIndex
  const activeSectionRef = useRef(activeSection)
  activeSectionRef.current = activeSection
  const isSeekingRef = useRef(false)

  // Cleanup audio resources helper
  const releaseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    activeHrefRef.current = null
    setCurrentTime(0)
    setDuration(0)
  }, [])

  // Highlight Range for the specified cue
  const updateHighlight = useCallback(async (sectionIdx: number, cueIdx: number) => {
    if (!renderer) return
    const range = await renderer.getMediaOverlayCueRange(sectionIdx, cueIdx)
    renderer.setMediaOverlayHighlight(range)
  }, [renderer])

  // Play a specific cue in a section
  const playCue = useCallback(async (sectionIdx: number, targetCueIdx: number) => {
    if (!renderer) return
    const cues = cuesRef.current
    const cue = cues[targetCueIdx]
    if (!cue) return

    const claim = await coordinator.claim('media')
    if (!claim.accepted || !claim.isCurrent()) return
    renderer.pauseInlineMedia()

    setCueIndex(targetCueIdx)
    cueIndexRef.current = targetCueIdx
    setActiveSection(sectionIdx)
    activeSectionRef.current = sectionIdx

    let audio = audioRef.current
    if (!audio || activeHrefRef.current !== cue.audioHref) {
      releaseAudio()
      const blob = await renderer.getMediaOverlayAudioByHref(cue.audioHref)
      if (!claim.isCurrent() || !blob) return
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      activeHrefRef.current = cue.audioHref
      audio = new Audio(url)
      audio.preload = 'auto'
      audioRef.current = audio

      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio?.duration) && (audio?.duration ?? 0) > 0) {
          setDuration(audio?.duration ?? 0)
        }
      })
    }

    const begin = cue.clipBegin ?? 0

    const onTimeUpdate = () => {
      if (!audio) return
      const t = audio.currentTime
      if (!isSeekingRef.current) {
        setCurrentTime(t)
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration)
        }
      }

      const allCues = cuesRef.current
      if (allCues.length === 0) return

      const activeAudioCues = activeHrefRef.current
        ? allCues.filter((c) => c.audioHref === activeHrefRef.current)
        : allCues

      const localIdx = findCueIndexForTime(activeAudioCues, t)
      const detectedIdx = activeAudioCues[localIdx]?.index ?? cueIndexRef.current

      if (detectedIdx !== cueIndexRef.current) {
        setCueIndex(detectedIdx)
        cueIndexRef.current = detectedIdx
        if (activeSectionRef.current !== null) {
          void updateHighlight(activeSectionRef.current, detectedIdx)
        }
      }

      const lastCue = activeAudioCues[activeAudioCues.length - 1]
      if (lastCue?.clipEnd !== null && lastCue?.clipEnd !== undefined && t >= lastCue.clipEnd) {
        renderer.clearMediaOverlayHighlight()
      }
    }

    const onEnded = () => {
      const nextIdx = cueIndexRef.current + 1
      if (nextIdx < cuesRef.current.length && activeSectionRef.current !== null) {
        void playCue(activeSectionRef.current, nextIdx)
        return
      }
      releaseAudio()
      renderer?.clearMediaOverlayHighlight()
      setStatus('idle')
    }

    audio.removeEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.removeEventListener('ended', onEnded)
    audio.addEventListener('ended', onEnded)

    audio.currentTime = begin
    setCurrentTime(begin)
    try {
      await audio.play()
      if (!claim.isCurrent()) {
        audio.pause()
        return
      }
      setStatus('playing')
      void updateHighlight(sectionIdx, targetCueIdx)
    } catch {
      releaseAudio()
      setStatus('idle')
      renderer.clearMediaOverlayHighlight()
    }
  }, [coordinator, releaseAudio, renderer, updateHighlight])

  const handleTogglePlay = useCallback(async () => {
    if (!renderer) return
    if (status === 'playing') {
      audioRef.current?.pause()
      setStatus('paused')
      return
    }
    if (status === 'paused' && audioRef.current) {
      const claim = await coordinator.claim('media')
      if (!claim.accepted || !claim.isCurrent()) return
      renderer.pauseInlineMedia()
      try {
        await audioRef.current.play()
        setStatus('playing')
        if (activeSectionRef.current !== null) {
          void updateHighlight(activeSectionRef.current, cueIndexRef.current)
        }
      } catch {
        releaseAudio()
        setStatus('idle')
      }
      return
    }
    // Start fresh from current chapter
    const sectionIdx = currentChapterIndex ?? 0
    await playCue(sectionIdx, 0)
  }, [coordinator, currentChapterIndex, playCue, releaseAudio, renderer, status, updateHighlight])

  const handleSeek = useCallback(async (newTime: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = newTime
    setCurrentTime(newTime)

    const allCues = cuesRef.current
    if (allCues.length === 0) return
    const activeAudioCues = activeHrefRef.current
      ? allCues.filter((c) => c.audioHref === activeHrefRef.current)
      : allCues
    const localIdx = findCueIndexForTime(activeAudioCues, newTime)
    const targetCueIdx = activeAudioCues[localIdx]?.index ?? cueIndexRef.current
    setCueIndex(targetCueIdx)
    cueIndexRef.current = targetCueIdx
    if (activeSectionRef.current !== null) {
      void updateHighlight(activeSectionRef.current, targetCueIdx)
    }
  }, [updateHighlight])

  const handlePrevious = useCallback(async () => {
    const audio = audioRef.current
    const cues = cuesRef.current
    const currentIdx = cueIndexRef.current

    // 1. If deep into current cue (> 3s), rewind to start of current cue
    const currentCue = cues[currentIdx]
    const begin = currentCue?.clipBegin ?? (currentIdx === 0 ? 0 : cues[currentIdx - 1]?.clipEnd ?? 0)
    if (audio && audio.currentTime > begin + 3) {
      void handleSeek(begin)
      return
    }

    // 2. If there is a previous cue in this chapter, jump to it
    if (currentIdx > 0 && activeSectionRef.current !== null) {
      void playCue(activeSectionRef.current, currentIdx - 1)
      return
    }

    // 3. If at cue 0, but audio is past 2s, rewind to start of track
    if (audio && audio.currentTime > 2) {
      void handleSeek(0)
      return
    }

    // 4. If at the very start (<= 2s), check if previous section has audio
    if (renderer && activeSectionRef.current !== null && activeSectionRef.current > 0) {
      const prevSectionIdx = activeSectionRef.current - 1
      const prevCues = await renderer.getMediaOverlayCues(prevSectionIdx)
      if (prevCues.length > 0) {
        cuesRef.current = prevCues
        void playCue(prevSectionIdx, 0)
      }
    }
  }, [handleSeek, playCue, renderer])

  const handleNext = useCallback(async () => {
    const audio = audioRef.current
    const cues = cuesRef.current
    const currentIdx = cueIndexRef.current

    // 1. If there is a next cue in this chapter, jump to it
    if (currentIdx + 1 < cues.length && activeSectionRef.current !== null) {
      void playCue(activeSectionRef.current, currentIdx + 1)
      return
    }

    // 2. If no more cues, but audio has remaining duration, seek forward 10s
    if (audio && Number.isFinite(audio.duration) && audio.currentTime < audio.duration - 1) {
      const targetTime = Math.min(audio.duration, audio.currentTime + 10)
      void handleSeek(targetTime)
      return
    }

    // 3. If at end of track, check if next chapter has audio
    if (renderer && activeSectionRef.current !== null) {
      const nextSectionIdx = activeSectionRef.current + 1
      const nextCues = await renderer.getMediaOverlayCues(nextSectionIdx)
      if (nextCues.length > 0) {
        cuesRef.current = nextCues
        void playCue(nextSectionIdx, 0)
      }
    }
  }, [handleSeek, playCue, renderer])

  const handleStop = useCallback(() => {
    releaseAudio()
    renderer?.clearMediaOverlayHighlight()
    setStatus('idle')
    const targetIndex = currentChapterIndex ?? 0
    void renderer?.getMediaOverlayCues(targetIndex).then((cues) => {
      if (cues && cues.length > 0) {
        cuesRef.current = cues
        setAvailable(true)
      } else {
        cuesRef.current = []
        setAvailable(false)
      }
    })
  }, [currentChapterIndex, releaseAudio, renderer])

  // Coordinate with coordinator: pause if another playback (e.g. TTS or in-page video) starts
  useEffect(() => {
    const unregister = coordinator.register('media', () => {
      audioRef.current?.pause()
      renderer?.clearMediaOverlayHighlight()
      if (statusRef.current === 'playing') {
        setStatus('paused')
      }
    })
    return unregister
  }, [coordinator, renderer])

  // Check cue availability when chapter/relocate changes
  useEffect(() => {
    if (!renderer) {
      setAvailable(false)
      return
    }

    let cancelled = false
    const checkCues = async () => {
      // If audio is actively playing or paused, do not clobber active cues or available state
      if (statusRef.current !== 'idle') return

      const targetIndex = currentChapterIndex ?? 0
      const cues = await renderer.getMediaOverlayCues(targetIndex)
      if (cancelled) return

      if (cues.length > 0) {
        cuesRef.current = cues
        setAvailable(true)
      } else {
        cuesRef.current = []
        setAvailable(false)
      }
    }

    void checkCues()
    const unsubRelocated = renderer.on('relocated', () => void checkCues())
    return () => {
      cancelled = true
      unsubRelocated()
    }
  }, [currentChapterIndex, renderer])

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      releaseAudio()
      renderer?.clearMediaOverlayHighlight()
    }
  }, [releaseAudio, renderer])

  if (!available && status === 'idle') return null

  const fillPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return (
    <div className={cn('pointer-events-auto z-[60]', inline ? 'relative' : 'absolute bottom-14 right-16')}>
      <style>{`
.bd-audio-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  height: 18px;
}
.bd-audio-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg)) 0%,
    color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg)) var(--audio-fill, 0%),
    color-mix(in srgb, var(--bd-read-text) 20%, var(--bd-read-bg)) var(--audio-fill, 0%),
    color-mix(in srgb, var(--bd-read-text) 20%, var(--bd-read-bg)) 100%
  );
}
.bd-audio-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text) 90%, var(--bd-read-bg));
  margin-top: -3px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 0 1.5px var(--bd-read-bg, #ffffff);
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
}
.bd-audio-slider:hover::-webkit-slider-thumb {
  transform: scale(1.25);
  box-shadow: 0 1.5px 4px rgba(0, 0, 0, 0.3), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-audio-slider:active::-webkit-slider-thumb {
  transform: scale(1.35);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-audio-slider::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg)) 0%,
    color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg)) var(--audio-fill, 0%),
    color-mix(in srgb, var(--bd-read-text) 20%, var(--bd-read-bg)) var(--audio-fill, 0%),
    color-mix(in srgb, var(--bd-read-text) 20%, var(--bd-read-bg)) 100%
  );
  border: none;
}
.bd-audio-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text) 90%, var(--bd-read-bg));
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 0 1.5px var(--bd-read-bg, #ffffff);
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
}
.bd-audio-slider:hover::-moz-range-thumb {
  transform: scale(1.25);
  box-shadow: 0 1.5px 4px rgba(0, 0, 0, 0.3), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-audio-slider:active::-moz-range-thumb {
  transform: scale(1.35);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-audio-slider:focus-visible {
  outline: none;
}
`}</style>
      {status === 'idle' ? (
        <button
          type="button"
          onClick={() => void handleTogglePlay()}
          title={_('reader.mediaTitle')}
          aria-label={_('reader.mediaTitle')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] text-[var(--bd-read-sub)] shadow-xl transition-all hover:bg-stone-500/10 hover:text-[var(--bd-read-text)] active:scale-95"
        >
          <HeadphoneIcon />
        </button>
      ) : (
        <div className="flex h-11 items-center gap-1.5 rounded-full border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] px-2.5 shadow-xl backdrop-blur-md">
          {/* Previous cue / rewind */}
          <button
            type="button"
            onClick={() => void handlePrevious()}
            disabled={currentTime <= 1 && (activeSection === null || activeSection <= 0)}
            title={_('reader.ttsPrevious')}
            aria-label={_('reader.ttsPrevious')}
            className={cn(actionButton)}
          >
            <PreviousIcon />
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            title={status === 'paused' ? _('reader.ttsResume') : _('reader.ttsPause')}
            aria-label={status === 'paused' ? _('reader.ttsResume') : _('reader.ttsPause')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bd-read-text)] text-[var(--bd-read-bg)] transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:opacity-50"
          >
            {status === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </button>

          {/* Next cue / fast-forward */}
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={duration > 0 && currentTime >= duration - 0.5}
            title={_('reader.ttsNext')}
            aria-label={_('reader.ttsNext')}
            className={cn(actionButton)}
          >
            <NextIcon />
          </button>

          {/* Inline Scrubber Progress Bar & Time */}
          <div className="flex items-center gap-2 px-1">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.1}
              value={currentTime}
              style={{ '--audio-fill': `${fillPercent}%` } as React.CSSProperties}
              onMouseDown={() => { isSeekingRef.current = true }}
              onTouchStart={() => { isSeekingRef.current = true }}
              onChange={(e) => {
                setCurrentTime(Number(e.target.value))
              }}
              onMouseUp={(e) => {
                isSeekingRef.current = false
                void handleSeek(Number((e.target as HTMLInputElement).value))
              }}
              onTouchEnd={(e) => {
                isSeekingRef.current = false
                void handleSeek(Number((e.target as HTMLInputElement).value))
              }}
              className="bd-audio-slider w-20 sm:w-28 focus:outline-none"
              title={`${formatTime(currentTime)} / ${formatTime(duration)}`}
              aria-label="音频播放进度"
            />
            <span className="font-mono text-[10px] sm:text-[11px] tabular-nums text-[var(--bd-read-sub)] select-none whitespace-nowrap">
              {formatTime(currentTime)}<span className="mx-0.5 opacity-40">/</span>{formatTime(duration)}
            </span>
          </div>

          {/* Stop / Close */}
          <button
            type="button"
            onClick={handleStop}
            title={_('reader.ttsStop')}
            aria-label={_('reader.ttsStop')}
            className={cn(actionButton)}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
})

export default MediaOverlayPill
