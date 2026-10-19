import { describe, expect, it } from 'vitest'

import { archiveBooksQuerySchema, readingRangeSchema, readingRecordHourlySchema, readingRecordRangeSchema } from '@bookdock/shared'

import { isReadingTimestampInBounds, readingTimestampBounds } from './reading-range'

describe('reading range boundaries', () => {
  it.each([
    ['2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
  ])('uses actual DST day boundaries for %s', (date, from, until) => {
    const bounds = readingTimestampBounds({ from: date, to: date, timezone: 'America/New_York' })
    expect(bounds).toEqual({ from: Date.parse(from), until: Date.parse(until) })
    expect(isReadingTimestampInBounds(bounds.from! - 1, bounds)).toBe(false)
    expect(isReadingTimestampInBounds(bounds.from!, bounds)).toBe(true)
    expect(isReadingTimestampInBounds(bounds.until! - 1, bounds)).toBe(true)
    expect(isReadingTimestampInBounds(bounds.until!, bounds)).toBe(false)
  })

  it('handles positive offsets, open bounds and skipped calendar dates', () => {
    expect(readingTimestampBounds({ from: '2026-10-18', timezone: 'Asia/Shanghai' })).toEqual({ from: Date.parse('2026-10-17T16:00:00Z'), until: undefined })
    expect(readingTimestampBounds({ from: '2011-12-30', to: '2011-12-30', timezone: 'Pacific/Apia' })).toEqual({ from: Date.parse('2011-12-30T10:00:00Z'), until: Date.parse('2011-12-30T10:00:00Z') })
    expect(readingTimestampBounds({})).toEqual({})
  })

  it.each([readingRangeSchema, archiveBooksQuerySchema, readingRecordRangeSchema, readingRecordHourlySchema])('validates calendar dates, zones and ordered bounds consistently', (schema) => {
    for (const input of [
      { from: '2026-02-30' }, { to: '2026-13-01' }, { from: '2026-10-19', to: '2026-10-18' },
      { from: '2026-10-18', timezone: 'Invalid/Zone' },
    ]) expect(schema.safeParse(input).success).toBe(false)
    expect(schema.safeParse({ from: '2024-02-29', to: '2024-02-29', timezone: 'Asia/Shanghai' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(true)
  })
})
