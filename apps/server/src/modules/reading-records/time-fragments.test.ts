import { describe, expect, it } from 'vitest'

import { mergeTimeFragments, splitReadingTime, subtractTimeFragments } from './time-fragments'

const fragment = (start: string, end: string) => ({ startedAt: Date.parse(start), endedAt: Date.parse(end) })

describe('reading time fragments', () => {
  it('splits midnight in the recorded zone and conserves milliseconds', () => {
    expect(splitReadingTime([fragment('2026-10-17T15:59:59.750Z', '2026-10-17T16:00:00.250Z')], 'Asia/Shanghai')).toEqual([
      { date: '2026-10-17', hour: 23, durationSeconds: 0.25 },
      { date: '2026-10-18', hour: 0, durationSeconds: 0.25 },
    ])
  })

  it('excludes pauses and deduplicates overlapping fragments', () => {
    expect(splitReadingTime([
      fragment('2026-10-18T10:00:00Z', '2026-10-18T10:10:00Z'),
      fragment('2026-10-18T10:05:00Z', '2026-10-18T10:15:00Z'),
      fragment('2026-10-18T10:30:00Z', '2026-10-18T10:35:00Z'),
    ], 'UTC')).toEqual([{ date: '2026-10-18', hour: 10, durationSeconds: 1200 }])
  })

  it('handles the missing spring hour and repeated fall hour', () => {
    expect(splitReadingTime([fragment('2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z')], 'America/New_York')).toEqual([
      { date: '2026-03-08', hour: 1, durationSeconds: 1800 },
      { date: '2026-03-08', hour: 3, durationSeconds: 1800 },
    ])
    expect(splitReadingTime([fragment('2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z')], 'America/New_York')).toEqual([
      { date: '2026-11-01', hour: 1, durationSeconds: 7200 },
    ])
  })

  it('handles half-hour DST transitions', () => {
    expect(splitReadingTime([fragment('2026-10-03T15:00:00Z', '2026-10-03T16:00:00Z')], 'Australia/Lord_Howe')).toEqual([
      { date: '2026-10-04', hour: 1, durationSeconds: 1800 },
      { date: '2026-10-04', hour: 2, durationSeconds: 1800 },
    ])
  })

  it('subtracts overlap without mutating input and rejects invalid facts', () => {
    const input = [{ startedAt: 0, endedAt: 10_000 }]
    expect(subtractTimeFragments(input, [{ startedAt: 2000, endedAt: 4000 }, { startedAt: 8000, endedAt: 12_000 }])).toEqual([
      { startedAt: 0, endedAt: 2000 }, { startedAt: 4000, endedAt: 8000 },
    ])
    expect(input[0].endedAt).toBe(10_000)
    expect(mergeTimeFragments([{ startedAt: 0, endedAt: 0 }])).toEqual([])
    expect(() => mergeTimeFragments([{ startedAt: 10, endedAt: 0 }])).toThrow(RangeError)
    expect(() => splitReadingTime(input, 'Invalid/Zone')).toThrow(RangeError)
  })
})
