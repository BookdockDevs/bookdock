import { describe, expect, it } from 'vitest'

import { formatTimestamp } from './format-timestamp'

// 2026-09-30T23:30Z — a timestamp whose date differs either side of the
// boundary depending on the zone, which is exactly what makes the zone matter.
const BOUNDARY = Date.UTC(2026, 8, 30, 23, 30)

describe('formatTimestamp', () => {
  it('renders in the supplied zone, not in UTC', () => {
    expect(formatTimestamp(BOUNDARY, 'UTC')).toBe('2026-09-30 23:30')
    expect(formatTimestamp(BOUNDARY, 'Asia/Shanghai')).toBe('2026-10-01 07:30')
    expect(formatTimestamp(BOUNDARY, 'America/New_York')).toBe('2026-09-30 19:30')
  })

  it('falls back to UTC when no zone is known', () => {
    expect(formatTimestamp(BOUNDARY, null)).toBe('2026-09-30 23:30')
    expect(formatTimestamp(BOUNDARY, undefined)).toBe('2026-09-30 23:30')
  })

  it('renders midnight as 00 rather than the 24 some ICU versions emit', () => {
    expect(formatTimestamp(Date.UTC(2026, 8, 30, 16, 0), 'Asia/Shanghai')).toBe('2026-10-01 00:00')
    expect(formatTimestamp(Date.UTC(2026, 8, 30, 16, 0), 'UTC')).toBe('2026-09-30 16:00')
  })

  it('degrades to UTC instead of throwing on a zone the runtime rejects', () => {
    // Zones are validated on write, but a restored backup or a hand-edited row
    // can still carry one this runtime does not know, and Intl throws RangeError.
    expect(formatTimestamp(BOUNDARY, 'Not/AZone')).toBe('2026-09-30 23:30')
  })

  it('renders nothing for a non-finite timestamp', () => {
    expect(formatTimestamp(Number.NaN, 'Asia/Shanghai')).toBe('')
    expect(formatTimestamp(Number.POSITIVE_INFINITY, null)).toBe('')
  })
})
