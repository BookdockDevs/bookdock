import { describe, expect, it } from 'vitest'

import type { ReadingLedgerSession } from '@bookdock/shared'

import { ledgerCoverageByDate, ledgerEstimates, ledgerInitialFraction, ledgerScopedWords, ledgerTimeDistribution } from './reading-ledger-stats'

function session(overrides: Partial<ReadingLedgerSession> = {}): ReadingLedgerSession {
  return { id: 's1', roundId: 'r1', source: 'manual', date: '2026-10-17', startedAt: null, endedAt: null, durationSeconds: 120, startFraction: 0.1, endFraction: 0.2, wordCount: 10000, coverage: [[0.1, 0.2]], fragments: [], timezone: 'Asia/Shanghai', ...overrides }
}

describe('reading ledger statistics', () => {
  it('attributes only the selected midnight slice and its proportional original words without changing facts', () => {
    const record = session({ durationSeconds: 120, fragments: [{ startedAt: Date.parse('2026-10-17T15:59:30Z'), endedAt: Date.parse('2026-10-17T16:01:30Z') }] })
    const original = structuredClone(record)
    const range = { from: '2026-10-18', to: '2026-10-18', timezone: 'America/New_York' }
    const stats = ledgerTimeDistribution([record], range)
    expect([...stats.days]).toEqual([['2026-10-18', 90]])
    expect(stats.hours[0]).toBe(90)
    expect(stats.hours[23]).toBe(0)
    expect(ledgerScopedWords([record], range).words).toBeCloseTo(750)
    expect(record).toEqual(original)
  })

  it('keeps date-only records day-attributed and detects missing word evidence only in scope', () => {
    const records = [session({ source: 'retroactive', wordCount: null }), session({ id: 'outside', date: '2026-10-16' })]
    const range = { from: '2026-10-17', to: '2026-10-17' }
    expect([...ledgerTimeDistribution(records, range).days]).toEqual([['2026-10-17', 120]])
    expect(ledgerScopedWords(records, range)).toEqual({ words: 0, partial: true, wordsPerMinute: null })
    expect(ledgerScopedWords(records, { from: '2026-10-18' }).partial).toBe(false)
  })
  it('splits cross-midnight effective fragments in their recorded timezone and excludes pauses', () => {
    const fragments = [
      { startedAt: Date.parse('2026-10-17T15:59:30Z'), endedAt: Date.parse('2026-10-17T16:00:30Z') },
      { startedAt: Date.parse('2026-10-17T17:10:00Z'), endedAt: Date.parse('2026-10-17T17:11:00Z') },
    ]
    const stats = ledgerTimeDistribution([session({ fragments })])
    expect(stats.days.get('2026-10-17')).toBe(30)
    expect(stats.days.get('2026-10-18')).toBe(90)
    expect(stats.hours[23]).toBe(30)
    expect(stats.hours[0]).toBe(30)
    expect(stats.hours[1]).toBe(60)
  })

  it('keeps unknown-time retroactive records out of hourly distribution', () => {
    const stats = ledgerTimeDistribution([session({ source: 'retroactive' })])
    expect(stats.days.get('2026-10-17')).toBe(120)
    expect(stats.hours.reduce((sum, seconds) => sum + seconds, 0)).toBe(0)
  })

  it('finds exact local day boundaries in fractional-hour timezones', () => {
    const stats = ledgerTimeDistribution([session({ timezone: 'Asia/Kathmandu', fragments: [{ startedAt: Date.parse('2026-10-17T18:10:00Z'), endedAt: Date.parse('2026-10-17T18:20:00Z') }] })])
    expect(stats.days.get('2026-10-17')).toBe(300)
    expect(stats.days.get('2026-10-18')).toBe(300)
    expect(stats.hours[23]).toBe(300)
    expect(stats.hours[0]).toBe(300)
  })

  it('preserves the repeated local hour during daylight saving changes', () => {
    const stats = ledgerTimeDistribution([session({ timezone: 'America/New_York', fragments: [{ startedAt: Date.parse('2026-11-01T05:30:00Z'), endedAt: Date.parse('2026-11-01T06:30:00Z') }] })])
    expect(stats.hours[1]).toBe(3600)
    expect(stats.days.get('2026-11-01')).toBe(3600)
  })

  it('estimates from one day without counting skipped content as read', () => {
    const estimates = ledgerEstimates([session({ coverage: [[0.1, 0.12], [0.5, 0.52]], durationSeconds: 240 })], 0.04)
    expect(estimates.words).toBeCloseTo(400)
    expect(estimates.wordsPerMinute).toBeCloseTo(100)
    expect(estimates.remainingSeconds).toBeCloseTo(5760)
  })

  it('builds cumulative coverage without adding repeated and overlapping ranges', () => {
    const values = ledgerCoverageByDate([session({ date: '2026-10-18', coverage: [[0.15, 0.3]] }), session({ date: '2026-10-17', coverage: [[0.1, 0.2]] })])
    expect(values.get('2026-10-17')).toBeCloseTo(0.1)
    expect(values.get('2026-10-18')).toBeCloseTo(0.2)
  })

  it('uses projected coverage for the current-content trend but original content for words', () => {
    const record = session({ coverage: [[0, 0.5]], projectedCoverage: [[0, 0.25]], wordCount: 10000 })
    expect(ledgerCoverageByDate([record]).get(record.date)).toBeCloseTo(0.25)
    expect(ledgerEstimates([record], 0.25, 20000).words).toBe(5000)
  })

  it('does not invent a reading speed when there is no progress sample', () => {
    const estimates = ledgerEstimates([session({ coverage: [] })], 0.2)
    expect(estimates.remainingSeconds).toBeNull()
    expect(estimates.wordsPerMinute).toBeNull()
  })

  it('computes initial fraction based on current round sessions and scale', () => {
    const s1 = session({ roundId: 'r1', progressScale: 0.5, startFraction: 0.1, endFraction: 0.2 })
    expect(ledgerInitialFraction({
      rounds: [{ id: 'r1', ordinal: 1, status: 'reading', startedAt: 0, endedAt: null, coverage: 0, totalSeconds: 0, wordCount: 1000, legacyCoverage: false }],
      currentRoundId: 'r1',
      sessions: [s1],
    })).toBe(0.1)
    expect(ledgerInitialFraction(null)).toBeUndefined()
  })
})
