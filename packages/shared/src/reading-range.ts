import { z } from 'zod'

export interface ReadingRange {
  from?: string
  to?: string
  timezone?: string
}

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

export const readingTimezoneSchema = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Invalid timezone')

export const readingRangeShape = {
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  timezone: readingTimezoneSchema.optional(),
}

export function isOrderedReadingRange(range: ReadingRange): boolean {
  return !range.from || !range.to || range.from <= range.to
}

export const readingRangeSchema = z.object(readingRangeShape).refine(isOrderedReadingRange, { message: 'Range ends before it starts', path: ['to'] })
