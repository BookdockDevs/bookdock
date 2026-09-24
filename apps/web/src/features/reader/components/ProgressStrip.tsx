import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Chapter } from '@bookdock/shared'
import { chapterIndexAtFraction } from '../lib/progress-model'

interface ProgressStripProps {
  percent: number
  pageInfo?: { page: number; total: number }
  visible: boolean
  /** Middle click-area tap forces the strip up (mobile: no hover) */
  pinned?: boolean
  /** Move the strip above the mobile tool dock while reading controls are visible. */
  mobileDockVisible?: boolean
  className?: string
  /** Chapter titles in section order for the drag-preview badge */
  chapters?: Chapter[]
  /**
   * Byte-weight section boundaries (foliate's progress model) — the drag
   * preview derives chapters from these so it matches the seek landing
   */
  sectionFractions?: number[] | null
  /** Labels resolved by Foliate's TOC progress model for each spine section. */
  sectionTocLabels?: string[] | null
  onPrevChapter: () => void
  onNextChapter: () => void
  onPageUp: () => void
  onPageDown: () => void
  onSeek: (percent: number) => void
}

export const ProgressStrip = memo(function ProgressStrip({
  percent,
  pageInfo,
  visible,
  pinned = false,
  mobileDockVisible = false,
  className,
  chapters,
  sectionFractions,
  sectionTocLabels,
  onPrevChapter,
  onNextChapter,
  onPageUp,
  onPageDown,
  onSeek,
}: ProgressStripProps) {
  const [sliderValue, setSliderValue] = useState(percent)
  const sliderValueRef = useRef(percent)
  const isDragging = useRef(false)
  // Uncontrolled range input: React writing value back every frame fights the
  // browser's drag state and makes fine moves jitter at small steps, so the
  // browser owns the value and external changes go through the ref instead.
  const sliderRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isDragging.current || !sliderRef.current) return
    sliderRef.current.value = String(percent)
    sliderValueRef.current = percent
    setSliderValue(percent)
  }, [percent])
  // Drag preview: while the thumb moves the chapter/percent texts and the
  // chapter badge follow the drag position; the actual jump happens on release
  const [dragValue, setDragValue] = useState<number | null>(null)

  // slider always tracks book-wide percent (smooth + matches seek); text shows chapter x/N
  const fillPercent = percent
  const progressText = pageInfo ? `${pageInfo.page} / ${pageInfo.total}` : `${percent}%`

  const dragIndex = dragValue !== null ? chapterIndexAtFraction(sectionFractions ?? null, dragValue) : null
  const dragChapterTitle = dragIndex !== null
    ? sectionTocLabels?.[dragIndex]
      || (sectionTocLabels == null && chapters && chapters.length === sectionFractions?.length
        ? chapters[dragIndex]?.title
        : undefined)
    : undefined
  // the 0.05% seek precision is for landing, not for the user to read
  const showingPercent = Math.round(dragValue ?? fillPercent)
  const showingChapterText = dragIndex !== null && chapters && sectionTocLabels == null
    ? `${dragIndex + 1} / ${chapters.length}`
    : progressText

  useEffect(() => {
    if (!isDragging.current) {
      setSliderValue(fillPercent)
    }
  }, [fillPercent])

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-0 right-0 z-40 flex h-[calc(3rem+env(safe-area-inset-bottom))] items-center gap-1.5 border-t border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-2 pb-[env(safe-area-inset-bottom)] text-xs transition-[bottom,translate] duration-300 sm:gap-3 sm:px-4',
        mobileDockVisible ? 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'bottom-[env(safe-area-inset-bottom)]',
        pinned || visible ? 'translate-y-0' : 'translate-y-full',
        className,
      )}
    >
      <style>{`
.bd-progress-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  width: 100%;
  height: 28px;
}
.bd-progress-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--bd-read-text) 80%, var(--bd-read-bg)) 0%,
    color-mix(in srgb, var(--bd-read-text) 80%, var(--bd-read-bg)) var(--slider-fill, 50%),
    color-mix(in srgb, var(--bd-read-text) 18%, var(--bd-read-bg)) var(--slider-fill, 50%),
    color-mix(in srgb, var(--bd-read-text) 18%, var(--bd-read-bg)) 100%
  );
}
.bd-progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg));
  margin-top: -5px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 0 1.5px var(--bd-read-bg, #ffffff);
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
}
.bd-progress-slider:hover::-webkit-slider-thumb {
  transform: scale(1.12);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-progress-slider:active::-webkit-slider-thumb {
  transform: scale(1.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 0 0 2.5px var(--bd-read-bg, #ffffff);
}
.bd-progress-slider::-moz-range-track {
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--bd-read-text) 80%, var(--bd-read-bg)) 0%,
    color-mix(in srgb, var(--bd-read-text) 80%, var(--bd-read-bg)) var(--slider-fill, 50%),
    color-mix(in srgb, var(--bd-read-text) 18%, var(--bd-read-bg)) var(--slider-fill, 50%),
    color-mix(in srgb, var(--bd-read-text) 18%, var(--bd-read-bg)) 100%
  );
  border: none;
}
.bd-progress-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg));
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 0 1.5px var(--bd-read-bg, #ffffff);
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
}
.bd-progress-slider:hover::-moz-range-thumb {
  transform: scale(1.12);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25), 0 0 0 2px var(--bd-read-bg, #ffffff);
}
.bd-progress-slider:active::-moz-range-thumb {
  transform: scale(1.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 0 0 2.5px var(--bd-read-bg, #ffffff);
}
.bd-progress-slider:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bd-read-text) 85%, var(--bd-read-bg));
  outline-offset: 2px;
}
.bd-drag-badge-text {
  text-autospace: normal;
  -webkit-text-autospace: normal;
}
`}</style>
      <button
        type="button"
        onClick={onPrevChapter}
        className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-all duration-150 hover:bg-[var(--bd-read-bg)] active:scale-95 sm:h-8 sm:w-8"
        aria-label="上一章"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNextChapter}
        className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-all duration-150 hover:bg-[var(--bd-read-bg)] active:scale-95 sm:h-8 sm:w-8"
        aria-label="下一章"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14m0 0-6-6m6 6-6 6" />
        </svg>
      </button>
      <div className="pointer-events-none flex flex-1 items-center gap-2 sm:gap-3">
        <span className="min-w-[3.25rem] shrink-0 text-right tabular-nums text-[var(--bd-read-sub)]">{showingChapterText}</span>
        <div className="relative flex-1">
          {dragChapterTitle && dragValue !== null && (
            <div
              className="pointer-events-none absolute bottom-full mb-6 -translate-x-1/2"
              style={{ left: `calc(8px + (100% - 16px) * ${dragValue / 100})` }}
            >
              <div className="relative min-w-0 max-w-[min(70vw,20rem)] rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)]/95 px-4 py-2 shadow-lg backdrop-blur-sm [text-autospace:normal]">
                <p className="truncate font-sans text-xs font-medium text-[var(--bd-read-text)] tabular-nums lining-nums sm:text-sm [text-autospace:normal] bd-drag-badge-text">
                  {dragChapterTitle}
                </p>
                <div className="absolute -bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)]" />
              </div>
            </div>
          )}
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            step={0.05}
            defaultValue={percent}
            onChange={(e) => {
              const v = Number(e.target.value)
              sliderValueRef.current = v
              setSliderValue(v)
              if (isDragging.current) setDragValue(v)
            }}
            onPointerDown={() => {
              isDragging.current = true
            }}
            onPointerUp={(e) => {
              isDragging.current = false
              setDragValue(null)
              // the slider keeps focus after a drag, swallowing arrow keys
              // (the window handler ignores INPUT targets) — release it so
              // keyboard page turns work right after seeking
              e.currentTarget.blur()
              onSeek(sliderValueRef.current)
            }}
            onMouseLeave={() => {
              if (isDragging.current) {
                isDragging.current = false
                setDragValue(null)
                sliderRef.current?.blur()
                onSeek(sliderValueRef.current)
              }
            }}
            onPointerCancel={(e) => {
              isDragging.current = false
              setDragValue(null)
              e.currentTarget.blur()
            }}
            className="pointer-events-auto bd-progress-slider"
            style={{ '--slider-fill': `${sliderValue}%` } as React.CSSProperties}
            aria-label="阅读进度"
          />
        </div>
        <span className="min-w-[2.5rem] shrink-0 text-left tabular-nums text-[var(--bd-read-sub)]">{showingPercent}%</span>
      </div>
      <button
        type="button"
        onClick={onPageUp}
        className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-all duration-150 hover:bg-[var(--bd-read-bg)] active:scale-95 sm:h-8 sm:w-8"
        aria-label="上一页"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onPageDown}
        className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-all duration-150 hover:bg-[var(--bd-read-bg)] active:scale-95 sm:h-8 sm:w-8"
        aria-label="下一页"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  )
})
