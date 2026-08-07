import type { Chapter } from '@bookdock/shared'

// Consistent with the remaining-time estimate (800 chars per minute), the
// book-level page counter treats 800 characters as one page.
export const CHARS_PER_PAGE = 800

// Reading-speed sampling (P2): the reader stores a sliding window of
// {fraction, at} samples taken from continuous reading stretches; the rate is
// derived client-side (see readingRateOf).
export const RATE_SAMPLE_MIN_INTERVAL_MS = 60_000
export const RATE_SAMPLE_PAIR_MIN_MS = 30_000
export const RATE_SAMPLE_PAIR_MAX_MS = 10 * 60_000
export const RATE_SAMPLE_MIN_PAIRS = 5

export interface RateSample {
  /** Book-wide position 0-1 at sample time */
  fraction: number
  /** Unix ms of the sample */
  at: number
}

// Reading speed (fraction per ms) from the sample window: pairwise deltas of
// adjacent samples, dropping pairs that span idle gaps (Δt too large — the
// window endpoints would otherwise include the idle stretch) or noise (Δt too
// small, backward movement), then the median — robust to fling bursts. Returns
// null until enough valid pairs accumulated, so callers fall back to a fixed
// chars-per-minute assumption.
export function readingRateOf(samples: RateSample[] | undefined): number | null {
  if (!samples || samples.length < RATE_SAMPLE_MIN_PAIRS + 1) return null
  const rates: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at
    if (dt < RATE_SAMPLE_PAIR_MIN_MS || dt > RATE_SAMPLE_PAIR_MAX_MS) continue
    const df = samples[i].fraction - samples[i - 1].fraction
    if (df <= 0) continue
    rates.push(df / dt)
  }
  if (rates.length < RATE_SAMPLE_MIN_PAIRS) return null
  rates.sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)]
}

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

// Cumulative byte-fraction boundaries of the book's sections, mirroring
// foliate's SectionProgress sizes (`linear != 'no' && size > 0 ? size : 0`).
// Seek, relocate and progress restore all speak this byte model, so the drag
// preview must use it too — a word-count model drifts by up to ~4 chapters
// mid-book (observed on a 1530-chapter book) and shows a different chapter
// than the one the seek actually lands on.
export function sectionFractionBoundaries(sizes: (number | undefined)[]): number[] | null {
  if (!sizes.length) return null
  const total = sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0)
  if (total <= 0) return null
  let acc = 0
  return sizes.map((s) => (acc += s ?? 0) / total)
}

// Chapter index at a book percent (0-100) under the byte model — mirrors
// foliate's getSection landing semantics: fraction + epsilon, first boundary
// strictly greater, 100% falls on the last chapter; zero-size sections are
// skipped naturally by their duplicate boundaries.
export function chapterIndexAtFraction(boundaries: number[] | null, percent: number): number | null {
  if (!boundaries || boundaries.length === 0) return null
  const frac = Math.max(0, Math.min(100, percent)) / 100
  const idx = boundaries.findIndex((b) => b > frac + 1e-9)
  return idx === -1 ? boundaries.length - 1 : idx
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
