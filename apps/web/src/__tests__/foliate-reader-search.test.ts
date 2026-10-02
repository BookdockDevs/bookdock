import { describe, expect, it, vi } from 'vitest'

import { FoliateReader } from '../features/reader/renderers/FoliateReader'
import type { SearchStatus } from '../features/reader/types'

let bookNumber = 0
const markup = (text: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${text}</p></body></html>`

function makeReader(load: (href: string) => Promise<string | null>, sections = ['a', 'b']) {
  const reader = new FoliateReader(`/api/v1/books/search-test-${++bookNumber}/file?v=1`)
  const view = { renderer: { getContents: () => [] } }
  Object.assign(reader, {
    view,
    book: { sections: sections.map((id) => ({ id })), loadSectionText: load },
  })
  return reader
}

describe('reader search lifecycle', () => {
  it('keeps spine order and detects truncation across a chapter boundary', async () => {
    const load = vi.fn(async (href: string) => markup(href === 'a' ? 'x'.repeat(2000) : 'x'))
    const reader = makeReader(load)
    const progress = vi.fn()
    const results = await reader.search('x', undefined, progress)
    expect(results).toHaveLength(2000)
    expect(results[0]!.cfi).toBe('search-hit:0:0:1')
    expect(results[1999]!.cfi).toBe('search-hit:0:1999:2000')
    expect(load).toHaveBeenCalledTimes(2)
    expect(progress.mock.lastCall?.[2]).toEqual({ truncated: true, incomplete: false })
    const cached = vi.fn()
    expect(await reader.search('x', undefined, cached)).toEqual(results)
    expect(cached.mock.lastCall?.[2]).toEqual({ truncated: true, incomplete: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not mark exactly 2000 hits as truncated and stops advancing the window after an overflow', async () => {
    const exact = makeReader(async () => markup('x'.repeat(2000)), ['a'])
    const progress = vi.fn()
    expect(await exact.search('x', undefined, progress)).toHaveLength(2000)
    expect(progress.mock.lastCall?.[2]).toEqual({ truncated: false, incomplete: false })
    const load = vi.fn(async () => markup('x'.repeat(2001)))
    expect(await makeReader(load, ['a', 'b', 'c', 'd', 'e', 'f']).search('x')).toHaveLength(2000)
    expect(load.mock.calls.map(([href]) => href)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reports incomplete loads and retries instead of caching a missing chapter', async () => {
    let failed = true
    const load = vi.fn(async (href: string) => {
      if (href === 'a' && failed) return null
      return markup('x')
    })
    const reader = makeReader(load)
    const progress = vi.fn()
    expect(await reader.search('x', undefined, progress)).toHaveLength(1)
    expect(progress.mock.lastCall?.[2]).toEqual({ truncated: false, incomplete: true })
    failed = false
    const results = await reader.search('x', undefined, progress)
    expect(results.map((result) => result.cfi)).toEqual(['search-hit:0:0:1', 'search-hit:1:0:1'])
    expect(progress.mock.lastCall?.[2]).toEqual({ truncated: false, incomplete: false })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('supersedes a pending search without publishing old results', async () => {
    let resolve!: (value: string) => void
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const reader = makeReader(load, ['a'])
    const oldProgress = vi.fn()
    const old = reader.search('old', undefined, oldProgress)
    const nextProgress = vi.fn()
    const next = reader.search('new', undefined, nextProgress)
    resolve(markup('old new'))
    expect(await old).toEqual([])
    expect(oldProgress).not.toHaveBeenCalled()
    expect(await next).toHaveLength(1)
    expect(nextProgress.mock.lastCall?.[0][0].excerpt.match).toBe('new')
  })

  it('stops consuming chapters after clearSearch', async () => {
    const releases: Array<(value: string) => void> = []
    const load = vi.fn(() => new Promise<string>((done) => { releases.push(done) }))
    const reader = makeReader(load, ['a', 'b', 'c', 'd', 'e', 'f'])
    const progress = vi.fn()
    const pending = reader.search('x', undefined, progress)
    reader.clearSearch()
    for (const resolve of releases) resolve(markup('x'))
    expect(await pending).toEqual([])
    expect(load).toHaveBeenCalledTimes(4)
    expect(progress).not.toHaveBeenCalled()
  })

  it('bounds the preparation window and consumes out-of-order loads in spine order', async () => {
    const releases = new Map<string, (value: string) => void>()
    let active = 0
    let peak = 0
    const load = vi.fn((href: string) => new Promise<string>((resolve) => {
      active++
      peak = Math.max(peak, active)
      releases.set(href, (value) => { active--; resolve(value) })
    }))
    const reader = makeReader(load, ['a', 'b', 'c', 'd', 'e', 'f'])
    const progress = vi.fn()
    const pending = reader.search('x', undefined, progress)
    expect(load.mock.calls.map(([href]) => href)).toEqual(['a', 'b', 'c', 'd'])
    for (const href of ['d', 'c', 'b']) releases.get(href)!(markup('x'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(load).toHaveBeenCalledTimes(4)
    expect(progress).not.toHaveBeenCalled()
    releases.get('a')!(markup('x'))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(6))
    releases.get('f')!(markup('x'))
    releases.get('e')!(markup('x'))
    const results = await pending
    expect(peak).toBe(4)
    expect(results.map((result) => result.cfi)).toEqual(
      Array.from({ length: 6 }, (_, index) => `search-hit:${index}:0:1`),
    )
    for (const [snapshot] of progress.mock.calls) {
      expect(snapshot).toEqual(results.slice(0, snapshot.length))
    }
    expect(progress.mock.lastCall?.[1]).toBe(1)
  })

  it('prepares only the selected chapter for a chapter-scoped search', async () => {
    const load = vi.fn(async () => markup('x'))
    const reader = makeReader(load, ['a', 'b', 'c', 'd', 'e'])
    Object.assign(reader, { currentSectionIndex: 2 })
    const results = await reader.search('x', { scope: 'chapter' })
    expect(load.mock.calls.map(([href]) => href)).toEqual(['c'])
    expect(results[0]!.cfi).toBe('search-hit:2:0:1')
  })

  it('discards a chapter when transformation settings change during its load', async () => {
    let resolve!: (value: string) => void
    const reader = makeReader(() => new Promise<string>((done) => { resolve = done }), ['a'])
    const progress = vi.fn()
    const pending = reader.search('x', undefined, progress)
    Object.assign(reader, { conversion: 'traditional' })
    resolve(markup('x'))
    expect(await pending).toEqual([])
    expect(progress).not.toHaveBeenCalled()
  })

  it('draws every live hit using a single text-node traversal', async () => {
    const doc = new DOMParser().parseFromString(markup('x'.repeat(30)), 'application/xhtml+xml')
    const walk = vi.spyOn(doc, 'createTreeWalker')
    const reader = makeReader(async () => markup('x'.repeat(30)), ['a'])
    const addAnnotation = vi.fn(async () => {})
    Object.assign(reader, { view: {
      renderer: { getContents: () => [{ index: 0, doc }] },
      getCFI: (_index: number, range: Range) => `epubcfi(/6/2!/4/2:${range.startOffset})`,
      addAnnotation,
    } })
    expect(await reader.search('x')).toHaveLength(30)
    expect(addAnnotation).toHaveBeenCalledTimes(30)
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('does not treat unavailable regex execution as a completed no-match result', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      const load = vi.fn(async () => markup('x'))
      const reader = makeReader(load, ['a', 'b', 'c', 'd', 'e', 'f'])
      const statuses: SearchStatus[] = []
      await reader.search('x', { mode: 'regex' }, (_results, _progress, status) => { if (status) statuses.push(status) })
      expect(statuses.at(-1)).toEqual({ truncated: false, incomplete: true, error: 'regex-unavailable' })
      expect(load).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('yields during cached CPU batches so cancellation can interrupt a long scan', async () => {
    const reader = makeReader(async () => markup('x'), Array.from({ length: 40 }, (_, i) => String(i)))
    const clock = vi.spyOn(performance, 'now')
    let time = 0
    clock.mockImplementation(() => { time += 20; return time })
    const progress = vi.fn()
    try {
      const pending = reader.search('x', undefined, progress)
      setTimeout(() => reader.clearSearch(), 0)
      const results = await pending
      expect(results.length).toBeLessThan(40)
      const emissions = progress.mock.calls.length
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(progress).toHaveBeenCalledTimes(emissions)
    } finally {
      clock.mockRestore()
    }
  })
})
