import type { Chapter } from '@bookdock/shared'

// Consistent with the remaining-time estimate (800 chars per minute), the
// book-level page counter treats 800 characters as one page.
export const CHARS_PER_PAGE = 800

export interface ChapterPercentRange {
  index: number
  title: string
  /** Inclusive chapter start percent (0-100) */
  startPct: number
  /** Exclusive chapter end percent (0-100) */
  endPct: number
}

// Word-count based percent ranges for chapter snapping. Returns null when any
// chapter lacks a word count (old books) — callers degrade to plain seek.
export function buildChapterPercentRanges(chapters: Chapter[] | undefined): ChapterPercentRange[] | null {
  if (!chapters || chapters.length === 0) return null
  const counts = chapters.map((c) => c.wordCount ?? 0)
  if (counts.some((n) => n <= 0)) return null
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return null
  let acc = 0
  const ranges: ChapterPercentRange[] = chapters.map((c, index) => {
    const startPct = (acc / total) * 100
    acc += counts[index]
    return { index, title: c.title, startPct, endPct: (acc / total) * 100 }
  })
  return ranges
}

export function chapterAtPercent(ranges: ChapterPercentRange[] | null, percent: number): ChapterPercentRange | null {
  if (!ranges || ranges.length === 0) return null
  const pct = Math.max(0, Math.min(100, percent))
  for (const r of ranges) {
    if (pct >= r.startPct && pct < r.endPct) return r
  }
  // percent == 100 lands on the last chapter
  return ranges[ranges.length - 1]
}

export function totalPagesOf(wordCount: number | undefined): number {
  return Math.max(1, Math.ceil((wordCount ?? 0) / CHARS_PER_PAGE))
}

// 1-based book-level page number for a percent.
export function pageOfPercent(percent: number, totalPages: number): number {
  const pct = Math.max(0, Math.min(100, percent))
  const page = Math.round((pct / 100) * totalPages)
  return Math.max(1, Math.min(totalPages, page))
}

// Page-aligned percent (fine-mode seek target).
export function pageAlignedPercent(percent: number, totalPages: number): number {
  return (pageOfPercent(percent, totalPages) / totalPages) * 100
}

// Fine-mode switch: sustained slow dragging (~300ms without a big move)
// flips coarse chapter snapping to page-level precision.
export const FINE_MODE_SLOW_MS = 300
export const FINE_MODE_SLOW_DELTA = 1.5

export class DragModeDetector {
  private mode: 'coarse' | 'fine' = 'coarse'
  private lastMoveAt = 0
  private lastValue: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  get(): 'coarse' | 'fine' {
    return this.mode
  }

  move(value: number) {
    if (this.mode === 'fine') return
    const now = Date.now()
    const dt = this.lastValue === null ? 0 : now - this.lastMoveAt
    const dv = this.lastValue === null ? 0 : Math.abs(value - this.lastValue)
    this.lastValue = value
    this.lastMoveAt = now
    if (dt === 0 || dv >= FINE_MODE_SLOW_DELTA) {
      this.clearTimer()
      return
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.mode = 'fine'
      }, FINE_MODE_SLOW_MS)
    }
  }

  reset() {
    this.clearTimer()
    this.mode = 'coarse'
    this.lastValue = null
    this.lastMoveAt = 0
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
