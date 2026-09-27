import { describe, expect, it } from 'vitest'

import { CATALOG_FALLBACK_SORT, libraryUrlCorrection } from '../features/library/library-filters'

/**
 * A shared library's list cannot filter or sort by anything that describes a
 * reader's relationship to a book. Accepting such a parameter and then ignoring
 * it is the failure mode here: the URL says one thing and the screen does
 * another, with nothing to notice it by.
 */
describe('libraryUrlCorrection', () => {
  const clean = { readStatus: null, sortBy: 'title', sortOrder: 'asc' as const }

  it('leaves an honest URL alone', () => {
    expect(libraryUrlCorrection(clean)).toEqual({})
  })

  it('drops read status, which belongs to books someone owns', () => {
    expect(libraryUrlCorrection({ ...clean, readStatus: 'reading' }))
      .toEqual({ status: undefined })
  })

  it.each(['progress', 'lastReadAt', 'deletedAt'])(
    'replaces the %s sort with newest-first rather than clearing it',
    (sortBy) => {
      const patch = libraryUrlCorrection({ ...clean, sortBy })
      // Replacing, not clearing: the reader's own sort preference may be exactly
      // this key, and clearing would let it come straight back.
      expect(patch).toEqual({ sortBy: CATALOG_FALLBACK_SORT, sortOrder: 'desc' })
    },
  )

  it('keeps the sorts a catalog can honour', () => {
    for (const sortBy of ['title', 'author', 'size', 'createdAt', 'updatedAt']) {
      expect(libraryUrlCorrection({ ...clean, sortBy })).toEqual({})
    }
  })

  it('corrects every offender in one pass', () => {
    expect(libraryUrlCorrection({ readStatus: 'finished', sortBy: 'progress', sortOrder: 'asc' }))
      .toEqual({ status: undefined, sortBy: 'createdAt', sortOrder: 'desc' })
  })

  it('is idempotent, so the correction cannot loop', () => {
    const once = libraryUrlCorrection({ readStatus: 'reading', sortBy: 'progress', sortOrder: 'asc' })
    const settled = { readStatus: null, sortBy: 'createdAt', sortOrder: 'desc' as const }
    expect(libraryUrlCorrection(settled)).toEqual({})
    expect(Object.keys(once).length).toBeGreaterThan(0)
  })
})
