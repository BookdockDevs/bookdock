import { describe, expect, it } from 'vitest'

import {
  FULL_DOWNLOAD_MAX_BYTES,
  memoizeLoadText,
  selectZipLoadStrategy,
  buildAnnotationBuckets,
  cfiSpinePrefix,
  sectionSpinePrefix,
} from '../features/reader/renderers/FoliateReader'
import type { ReaderAnnotation } from '../features/reader/types'

function ann(cfiRange: string, type: ReaderAnnotation['type'] = 'highlight'): ReaderAnnotation {
  return { cfiRange, type, color: 'yellow', style: 'underline', note: null }
}

describe('cfiSpinePrefix / sectionSpinePrefix', () => {
  it('extracts the spine part of a standard EPUB CFI', () => {
    expect(cfiSpinePrefix('epubcfi(/6/24!/4/2:58)')).toBe('/6/24')
  })

  it('returns null for non-EPUB cfis', () => {
    expect(cfiSpinePrefix('txt:/42/100')).toBeNull()
    expect(cfiSpinePrefix('chapter:3:0.5')).toBeNull()
  })

  it('maps a section index to its expected spine prefix', () => {
    expect(sectionSpinePrefix(0)).toBe('/6/2')
    expect(sectionSpinePrefix(11)).toBe('/6/24')
  })
})

describe('buildAnnotationBuckets', () => {
  it('groups annotations by spine prefix, keeping the cfi|type value', () => {
    const { buckets, uncategorized } = buildAnnotationBuckets([
      ann('epubcfi(/6/2!/4/2:0)'),
      ann('epubcfi(/6/2!/4/5:1)', 'note'),
      ann('epubcfi(/6/4!/4/1:3)'),
    ])
    expect(buckets.get('/6/2')).toEqual(new Set(['epubcfi(/6/2!/4/2:0)|highlight', 'epubcfi(/6/2!/4/5:1)|note']))
    expect(buckets.get('/6/4')).toEqual(new Set(['epubcfi(/6/4!/4/1:3)|highlight']))
    expect(uncategorized.size).toBe(0)
  })

  it('sends non-EPUB cfis to the uncategorized fallback set', () => {
    const { buckets, uncategorized } = buildAnnotationBuckets([ann('txt:/12/30')])
    expect(buckets.size).toBe(0)
    expect(uncategorized).toEqual(new Set(['txt:/12/30|highlight']))
  })
})

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

  it('has() reports warmth: requested-and-not-failed entries only', async () => {
    const loadText = memoizeLoadText(async (name: string) => {
      if (name === 'fail.xhtml') throw new Error('boom')
      return name
    })
    expect(loadText.has('a.xhtml')).toBe(false)
    await loadText('a.xhtml')
    expect(loadText.has('a.xhtml')).toBe(true)
    await expect(loadText('fail.xhtml')).rejects.toThrow('boom')
    expect(loadText.has('fail.xhtml')).toBe(false)
  })
})
