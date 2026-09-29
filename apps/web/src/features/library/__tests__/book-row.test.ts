import { describe, expect, it } from 'vitest'

import type { BookListItem, CatalogBook } from '@bookdock/shared'

import { getCoverPalette } from '../components/cover-palettes'
import { catalogWorkRow, privateBookRow, versionOrdinal, versionTabLabel } from '../book-row'

function version(): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'Coverless TXT', author: '', description: '', coverKey: null, coverPaletteKey: 'v1', bookmeta: {}, fileName: 'book.txt' },
    format: 'txt', size: 10, chapterCount: 1, wordCount: 2, guestReadable: false, pinnedAt: null, createdAt: 1, updatedAt: 1,
  }
}

function work(): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'Coverless TXT', author: '',
    description: '', coverKey: null, tags: [], versions: [version()], createdAt: 1, updatedAt: 1,
  }
}

function collectedBook(): BookListItem {
  return {
    id: 'v1', title: 'Coverless TXT', author: '', format: 'txt', coverKey: null, size: 10,
    readStatus: 'wishlist', progress: 0, createdAt: 1, updatedAt: 1, shelfId: null, coverPaletteKey: 'v1',
  }
}

describe('library book row cover identity', () => {
  it('keeps a coverless version color when it moves from a shared work to a private card', () => {
    const sharedRow = catalogWorkRow(work())
    const privateRow = privateBookRow(collectedBook())

    expect(sharedRow.coverPaletteKey).toBe('v1')
    expect(privateRow.coverPaletteKey).toBe('v1')
    expect(getCoverPalette(sharedRow.coverPaletteKey!).id)
      .toBe(getCoverPalette(privateRow.coverPaletteKey!).id)
  })
})

describe('versionTabLabel', () => {
  it('prefers the manager-set label and falls back to the ordinal', () => {
    expect(versionTabLabel('精校版', '第1版')).toBe('精校版')
    expect(versionTabLabel('', '第1版')).toBe('第1版')
    expect(versionTabLabel('   ', '第2版')).toBe('第2版')
  })
})

describe('versionOrdinal', () => {
  const versions = [
    { id: 'v1', createdAt: 100 },
    { id: 'v2', createdAt: 200 },
    { id: 'v3', createdAt: 300 },
  ]

  it('numbers by creation order regardless of display order', () => {
    // A default-first display order must not renumber unnamed versions.
    const reordered = [versions[2]!, versions[0]!, versions[1]!]
    expect(versionOrdinal(reordered, 'v1')).toBe(1)
    expect(versionOrdinal(reordered, 'v2')).toBe(2)
    expect(versionOrdinal(reordered, 'v3')).toBe(3)
  })

  it('breaks createdAt ties by id', () => {
    expect(versionOrdinal([{ id: 'b', createdAt: 5 }, { id: 'a', createdAt: 5 }], 'a')).toBe(1)
    expect(versionOrdinal([{ id: 'b', createdAt: 5 }, { id: 'a', createdAt: 5 }], 'b')).toBe(2)
  })
})
