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
  className?: string
  /** Chapter titles in section order for the drag-preview badge */
  chapters?: Chapter[]
  /**
   * Byte-weight section boundaries (foliate's progress model) — the drag
   * preview derives chapters from these so it matches the seek landing
   */
  sectionFractions?: number[] | null
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
  className,
  chapters,
  sectionFractions,
  onPrevChapter,
  onNextChapter,
  onPageUp,
  onPageDown,
  onSeek,
}: ProgressStripProps) {
  const [sliderValue, setSliderValue] = useState(percent)
  const isDragging = useRef(false)
  // Uncontrolled range input: React writing value back every frame fights the
  // browser's drag state and makes fine moves jitter at small steps, so the
  // browser owns the value and external changes go through the ref instead.
  const sliderRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isDragging.current || !sliderRef.current) return
    sliderRef.current.value = String(percent)
    setSliderValue(percent)
  }, [percent])
  // Drag preview: while the thumb moves the chapter/percent texts and the
  // chapter badge follow the drag position; the actual jump happens on release
  const [dragValue, setDragValue] = useState<number | null>(null)

  // slider always tracks book-wide percent (smooth + matches seek); text shows chapter x/N
  const fillPercent = percent
  const progressText = pageInfo ? `${pageInfo.page} / ${pageInfo.total}` : `${percent}%`

  const dragIndex = dragValue !== null ? chapterIndexAtFraction(sectionFractions ?? null, dragValue) : null
  const dragChapterTitle = dragIndex !== null && chapters ? chapters[dragIndex]?.title : undefined
  // the 0.05% seek precision is for landing, not for the user to read
  const showingPercent = Math.round(dragValue ?? fillPercent)
  const showingChapterText = dragIndex !== null && chapters
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
        'pointer-events-none absolute bottom-0 left-0 right-0 z-40 flex h-12 items-center gap-3 border-t border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-4 text-xs transition-transform duration-300',
        pinned || visible ? 'translate-y-0' : 'translate-y-full',
        className,
      )}
    >
      {dragChapterTitle && dragValue !== null && (
        <div
          className="pointer-events-none absolute bottom-full left-0 mb-3 -translate-x-1/2"
          style={{ left: `max(8%, min(${dragValue}%, 92%))` }}
        >
          <div className="min-w-0 max-w-[70vw] rounded-xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)]/95 px-4 py-2 shadow-lg backdrop-blur-sm">
            <p className="truncate font-serif text-sm font-medium text-[var(--bd-read-text)]">
              {dragChapterTitle}
            </p>
          </div>
        </div>
      )}
      <style>{`
.bd-progress-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  width: 100%;
  height: 20px;
}
.bd-progress-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%) 0%, color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%) var(--slider-fill, 50%), color-mix(in srgb, var(--bd-read-text) 10%, transparent) var(--slider-fill, 50%), color-mix(in srgb, var(--bd-read-text) 10%, transparent) 100%);
}
.bd-progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%);
  margin-top: -5px;
}
.bd-progress-slider::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%) 0%, color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%) var(--slider-fill, 50%), color-mix(in srgb, var(--bd-read-text) 10%, transparent) var(--slider-fill, 50%), color-mix(in srgb, var(--bd-read-text) 10%, transparent) 100%);
  border: none;
}
.bd-progress-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%);
  border: none;
}
.bd-progress-slider:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bd-read-text), var(--bd-read-bg) 45%);
  outline-offset: 2px;
}
`}</style>
      <button
        type="button"
        onClick={onPrevChapter}
        className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-colors hover:bg-[var(--bd-read-bg)]"
        aria-label="上一章"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNextChapter}
        className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-colors hover:bg-[var(--bd-read-bg)]"
        aria-label="下一章"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
      <div className="pointer-events-none flex flex-1 items-center gap-3">
        <span className="shrink-0 tabular-nums text-[var(--bd-read-sub)]">{showingChapterText}</span>
        <div className="relative flex-1">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            step={0.05}
            defaultValue={percent}
            onChange={(e) => {
              const v = Number(e.target.value)
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
              onSeek(sliderValue)
            }}
            onMouseLeave={() => {
              if (isDragging.current) {
                isDragging.current = false
                setDragValue(null)
                onSeek(sliderValue)
              }
            }}
            className="pointer-events-auto bd-progress-slider"
            style={{ '--slider-fill': `${sliderValue}%` } as React.CSSProperties}
            aria-label="阅读进度"
          />
        </div>
        <span className="shrink-0 tabular-nums text-[var(--bd-read-sub)]">{showingPercent}%</span>
      </div>
      <button
        type="button"
        onClick={onPageUp}
        className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-colors hover:bg-[var(--bd-read-bg)]"
        aria-label="上一页"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onPageDown}
        className="pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--bd-read-accent)] text-[var(--bd-read-text)] transition-colors hover:bg-[var(--bd-read-bg)]"
        aria-label="下一页"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  )
})
