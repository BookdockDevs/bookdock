import { describe, expect, it, vi } from 'vitest'

import { archiveRoute, type ArchiveSearch } from '@/routes/archive'

import { archiveScrollKey } from './archive-scroll'

vi.mock('@/routes/__root', async () => {
  const { createRootRoute } = await import('@tanstack/react-router')
  return { rootRoute: createRootRoute() }
})

const validate = archiveRoute.options.validateSearch as (search: Record<string, unknown>) => ArchiveSearch

describe('archive search state', () => {
  it('preserves the overview view while dropping retired pagination fields and invalid views', () => {
    const overview = validate({ view: 'overview', from: 'all', page: 9, bookId: 'b1', type: 'bookmark', sort: 'records' })
    expect(overview).toMatchObject({ view: 'overview', bookId: 'b1', type: 'bookmark', sort: 'most' })
    for (const key of ['from', 'page']) expect(overview).not.toHaveProperty(key)
    expect(archiveScrollKey(overview)).not.toBe(archiveScrollKey(validate({ bookId: 'b1', type: 'bookmark', sort: 'most' })))
    const legacy = validate({ view: 'book', bookId: 'b1', type: 'bookmark', sort: 'records' })
    expect(legacy.view).toBeUndefined()
    expect(validate({ sort: 'title' }).sort).toBe('title-asc')
  })
})
