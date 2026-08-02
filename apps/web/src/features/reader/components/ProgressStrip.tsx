import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ProgressStripProps {
  percent: number
  pageInfo?: { page: number; total: number }
  visible: boolean
  className?: string
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
  className,
  onPrevChapter,
  onNextChapter,
  onPageUp,
  onPageDown,
  onSeek,
}: ProgressStripProps) {
  const [sliderValue, setSliderValue] = useState(percent)
  const isDragging = useRef(false)

  // slider always tracks book-wide percent (smooth + matches seek); text shows chapter x/N
  const fillPercent = percent
  const progressText = pageInfo ? `${pageInfo.page} / ${pageInfo.total}` : `${percent}%`

  useEffect(() => {
    if (!isDragging.current) {
      setSliderValue(fillPercent)
    }
  }, [fillPercent])

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-0 left-0 right-0 z-40 flex h-12 items-center gap-3 border-t border-[var(--bd-read-accent)] bg-[var(--bd-read-page-bg)] px-4 text-xs transition-transform duration-300',
        visible ? 'translate-y-full group-hover:translate-y-0' : 'translate-y-full',
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
        <span className="shrink-0 tabular-nums text-[var(--bd-read-sub)]">{progressText}</span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={100}
            value={sliderValue}
            onChange={(e) => {
              setSliderValue(Number(e.target.value))
            }}
            onPointerDown={() => {
              isDragging.current = true
            }}
            onPointerUp={() => {
              isDragging.current = false
              onSeek(sliderValue)
            }}
            onMouseLeave={() => {
              if (isDragging.current) {
                isDragging.current = false
                onSeek(sliderValue)
              }
            }}
            className="pointer-events-auto bd-progress-slider"
            style={{ '--slider-fill': `${sliderValue}%` } as React.CSSProperties}
            aria-label="阅读进度"
          />
        </div>
        <span className="shrink-0 tabular-nums text-[var(--bd-read-sub)]">{fillPercent}%</span>
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
