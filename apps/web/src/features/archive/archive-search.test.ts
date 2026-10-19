import { describe, expect, it, vi } from 'vitest'

import { archiveRoute, type ArchiveSearch } from '@/routes/archive'

import { archiveScrollKey } from './archive-scroll'

vi.mock('@/routes/__root', async () => {
  const { createRootRoute } = await import('@tanstack/react-router')
  return { rootRoute: createRootRoute() }
})

const validate = archiveRoute.options.validateSearch as (search: Record<string, unknown>) => ArchiveSearch

describe('archive search state', () => {
  it('drops retired view and pagination fields without losing old book links', () => {
    const legacy = validate({ view: 'book', from: 'all', page: 9, bookId: 'b1', type: 'bookmark', sort: 'records' })
    expect(legacy).toMatchObject({ bookId: 'b1', type: 'bookmark', sort: 'most' })
    for (const key of ['view', 'from', 'page']) expect(legacy).not.toHaveProperty(key)
    expect(archiveScrollKey(legacy)).toBe(archiveScrollKey(validate({ bookId: 'b1', type: 'bookmark', sort: 'most' })))
    expect(validate({ sort: 'title' }).sort).toBe('title-asc')
  })
})
