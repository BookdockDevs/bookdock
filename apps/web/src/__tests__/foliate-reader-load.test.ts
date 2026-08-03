import { describe, expect, it } from 'vitest'

import {
  FULL_DOWNLOAD_MAX_BYTES,
  memoizeLoadText,
  selectZipLoadStrategy,
} from '../features/reader/renderers/FoliateReader'

describe('selectZipLoadStrategy', () => {
  it('downloads whole books at or below the threshold', () => {
    expect(selectZipLoadStrategy(1)).toBe('full')
    expect(selectZipLoadStrategy(FULL_DOWNLOAD_MAX_BYTES)).toBe('full')
  })

  it('keeps Range loading above the threshold', () => {
    expect(selectZipLoadStrategy(FULL_DOWNLOAD_MAX_BYTES + 1)).toBe('range')
  })

  it('defaults to Range when the size is unknown', () => {
    expect(selectZipLoadStrategy(null)).toBe('range')
  })
})

describe('memoizeLoadText', () => {
  it('dedupes concurrent loads of the same href', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (name: string) => {
      calls++
      return `text:${name}`
    })
    const [a, b] = await Promise.all([loadText('a.xhtml'), loadText('a.xhtml')])
    expect(a).toBe('text:a.xhtml')
    expect(b).toBe('text:a.xhtml')
    expect(calls).toBe(1)
  })

  it('serves repeated loads from the memo without re-invoking the source', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (name: string) => {
      calls++
      return `text:${name}`
    })
    await loadText('a.xhtml')
    await loadText('a.xhtml')
    expect(calls).toBe(1)
    expect(await loadText('b.xhtml')).toBe('text:b.xhtml')
    expect(calls).toBe(2)
  })

  it('evicts the least recently used href beyond 20 entries', async () => {
    const calls = new Map<string, number>()
    const loadText = memoizeLoadText(async (name: string) => {
      calls.set(name, (calls.get(name) ?? 0) + 1)
      return name
    })
    for (let i = 0; i < 20; i++) await loadText(`s${i}`)
    // touch s0 so it becomes most recently used
    await loadText('s0')
    // insert a 21st entry — evicts s1 (now the oldest), not s0
    await loadText('s20')
    await loadText('s0')
    await loadText('s1')
    expect(calls.get('s0')).toBe(1)
    expect(calls.get('s1')).toBe(2)
  })

  it('evicts rejected loads so the next request retries', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (_name: string) => {
      calls++
      if (calls === 1) throw new Error('boom')
      return 'ok'
    })
    await expect(loadText('a.xhtml')).rejects.toThrow('boom')
    expect(await loadText('a.xhtml')).toBe('ok')
    expect(calls).toBe(2)
  })

  it('passes through null for missing entries', async () => {
    const loadText = memoizeLoadText((_name: string) => null)
    expect(await loadText('missing.xhtml')).toBeNull()
  })
})
