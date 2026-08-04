import type { MarginalField } from '../types'

export interface MarginalContext {
  bookTitle: string
  chapterTitle: string
  /** 0-1 within the current chapter */
  chapterFraction: number | undefined
  /** 0-1 within the book */
  bookFraction: number | undefined
  /** Word count of the current chapter */
  chapterWordCount: number | undefined
  /** epoch ms (injectable for tests) */
  now?: number
}

export const MARGINAL_FIELDS: readonly MarginalField[] = [
  'none',
  'bookTitle',
  'chapter',
  'chapterProgress',
  'bookProgress',
  'chapterWordCount',
  'time',
]

export const DEFAULT_MARGINAL_CONFIG = {
  header: ['none', 'bookTitle', 'none'] as [MarginalField, MarginalField, MarginalField],
  footer: ['none', 'chapter', 'none'] as [MarginalField, MarginalField, MarginalField],
  fontSize: 0,
}

function formatFraction(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) return ''
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
}

function formatTime(now: number): string {
  return new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// Same shape as the removed bottom word-count badge: >=10000 renders as X.X万.
export function formatWordCount(count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return ''
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}万字`
  return `${count}字`
}

// Pure field -> text composition (F4). Returns '' for 'none' and for fields
// whose data isn't available yet.
export function composeMarginalText(field: MarginalField, ctx: MarginalContext): string {
  switch (field) {
    case 'none':
      return ''
    case 'bookTitle':
      return ctx.bookTitle
    case 'chapter':
      return ctx.chapterTitle
    case 'chapterProgress':
      return formatFraction(ctx.chapterFraction)
    case 'bookProgress':
      return formatFraction(ctx.bookFraction)
    case 'chapterWordCount':
      return formatWordCount(ctx.chapterWordCount)
    case 'time':
      return formatTime(ctx.now ?? Date.now())
  }
}

export function composeMarginalLine(
  fields: [MarginalField, MarginalField, MarginalField],
  ctx: MarginalContext,
): [string, string, string] {
  return [composeMarginalText(fields[0], ctx), composeMarginalText(fields[1], ctx), composeMarginalText(fields[2], ctx)]
}
