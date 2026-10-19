import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category, LibraryListItem } from '@bookdock/shared'

import {
  clearLibraryNamesSnapshot,
  readLibraryNames,
  readTaxonomyNames,
  saveLibrariesSnapshot,
  saveLibraryCategoriesSnapshot,
} from '@/lib/library-name-cache'

describe('library-name-cache', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('keeps only display fields and isolates snapshots by account', () => {
    saveLibrariesSnapshot('user-1', [{
      id: 'lib-1', type: 'shared', name: 'Shared', relation: 'owner', allowMemberUpload: true,
    } as LibraryListItem])
    saveLibraryCategoriesSnapshot('user-1', 'lib-1', [{
      id: 'cat-1', libraryId: 'lib-1', name: 'Fiction', parentId: null, userId: 'owner', hidden: true, bookCount: 12,
    } as Category])

    expect(readLibraryNames('user-1')).toEqual([{ id: 'lib-1', type: 'shared', name: 'Shared' }])
    expect(readTaxonomyNames('user-1', 'lib-1').categories).toEqual([{ id: 'cat-1', name: 'Fiction', parentId: null }])
    expect(readLibraryNames('user-2')).toEqual([])
    const serialized = localStorage.getItem('bd-library-names:v1:user-1') ?? ''
    expect(serialized).not.toMatch(/relation|allowMemberUpload|hidden|bookCount|userId/)
  })

  it('expires old snapshots and rejects malformed or oversized data', () => {
    saveLibrariesSnapshot('user-1', [{ id: 'lib-1', type: 'shared', name: 'Shared' } as LibraryListItem])
    const key = 'bd-library-names:v1:user-1'
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    saved.savedAt -= 31 * 24 * 60 * 60 * 1000
    localStorage.setItem(key, JSON.stringify(saved))
    expect(readLibraryNames('user-1')).toEqual([])

    localStorage.setItem(key, '{')
    expect(readLibraryNames('user-1')).toEqual([])
    localStorage.setItem(key, 'x'.repeat(160_001))
    expect(readLibraryNames('user-1')).toEqual([])
  })

  it('drops deleted library labels after a successful empty response and clears on logout', () => {
    saveLibrariesSnapshot('user-1', [{ id: 'lib-1', type: 'shared', name: 'Shared' } as LibraryListItem])
    saveLibraryCategoriesSnapshot('user-1', 'lib-1', [{ id: 'cat-1', libraryId: 'lib-1', name: 'Fiction', parentId: null } as Category])
    saveLibrariesSnapshot('user-1', [])
    expect(readLibraryNames('user-1')).toEqual([])
    expect(readTaxonomyNames('user-1', 'lib-1').categories).toEqual([])

    saveLibrariesSnapshot('user-1', [{ id: 'lib-2', type: 'shared', name: 'Other' } as LibraryListItem])
    clearLibraryNamesSnapshot()
    expect(readLibraryNames('user-1')).toEqual([])
  })
})
