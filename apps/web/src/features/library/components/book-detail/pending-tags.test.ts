import { describe, expect, it, vi } from 'vitest'

import { mergePendingTagNames, resolvePendingTagNames } from './pending-tags'

describe('pending scraped tags', () => {
  it('queues names without touching the library', () => {
    expect(mergePendingTagNames([], ['星空', ' 蒸汽朋克 ', ''])).toEqual(['星空', '蒸汽朋克'])
  })

  it('does not queue the same name twice, ignoring case', () => {
    expect(mergePendingTagNames(['Starfield'], ['starfield', '星空'])).toEqual(['Starfield', '星空'])
  })

  it('keeps the names already pending when a second source is applied', () => {
    expect(mergePendingTagNames(['江湖'], ['硬科幻'])).toEqual(['江湖', '硬科幻'])
  })

  it('reuses a tag that already exists instead of creating it again', async () => {
    const create = vi.fn(async (name: string) => `new:${name}`)
    const resolved = await resolvePendingTagNames(['江湖'], [{ id: 't1', name: '江湖' }], create)
    expect(resolved).toEqual({ ids: ['t1'], skipped: [] })
    expect(create).not.toHaveBeenCalled()
  })

  it('creates the missing names in order', async () => {
    const create = vi.fn(async (name: string) => `new:${name}`)
    const resolved = await resolvePendingTagNames(['硬科幻', '太空歌剧'], [], create)
    expect(resolved.ids).toEqual(['new:硬科幻', 'new:太空歌剧'])
    expect(resolved.skipped).toEqual([])
  })

  it('keeps a failed name pending while the rest still resolve', async () => {
    const create = vi.fn(async (name: string) => {
      if (name === '失败') throw new Error('duplicate')
      return `new:${name}`
    })
    const resolved = await resolvePendingTagNames(['失败', '星空'], [], create)
    expect(resolved.ids).toEqual(['new:星空'])
    expect(resolved.skipped).toEqual(['失败'])
  })
})
