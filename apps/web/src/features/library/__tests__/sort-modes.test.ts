import { describe, expect, it } from 'vitest'

import {
  BOOK_SORT_DEFAULT_DIR,
  SIDEBAR_DEFAULT_DIR,
  nextSidebarSort,
  sidebarSortDir,
  sortSidebarItems,
  type SidebarSortableItem,
} from '../sort-modes'

function item(name: string, bookCount: number, createdAt: number, updatedAt: number, pinned = false): SidebarSortableItem {
  return { name, bookCount, createdAt, updatedAt, pinned }
}

describe('sidebarSortDir', () => {
  it('returns asc for manual and undefined prefs (no direction concept)', () => {
    expect(sidebarSortDir(undefined)).toBe('asc')
    expect(sidebarSortDir({ mode: 'manual' })).toBe('asc')
  })

  it('falls back to the per-mode default when dir is omitted', () => {
    expect(sidebarSortDir({ mode: 'name' })).toBe('asc')
    expect(sidebarSortDir({ mode: 'bookCount' })).toBe('desc')
    expect(sidebarSortDir({ mode: 'recentlyAdded' })).toBe('desc')
    expect(sidebarSortDir({ mode: 'recentlyUpdated' })).toBe('desc')
  })

  it('honours an explicit dir', () => {
    expect(sidebarSortDir({ mode: 'name', dir: 'desc' })).toBe('desc')
    expect(sidebarSortDir({ mode: 'bookCount', dir: 'asc' })).toBe('asc')
  })
})

describe('nextSidebarSort', () => {
  it('picks the default direction when switching to a new mode', () => {
    expect(nextSidebarSort({ mode: 'name' }, 'bookCount')).toEqual({ mode: 'bookCount', dir: 'desc' })
    expect(nextSidebarSort(undefined, 'name')).toEqual({ mode: 'name', dir: 'asc' })
  })

  it('flips the direction when re-clicking the active mode', () => {
    expect(nextSidebarSort({ mode: 'name', dir: 'asc' }, 'name')).toEqual({ mode: 'name', dir: 'desc' })
    expect(nextSidebarSort({ mode: 'bookCount', dir: 'desc' }, 'bookCount')).toEqual({ mode: 'bookCount', dir: 'asc' })
    // no explicit dir yet: flip starts from the mode default
    expect(nextSidebarSort({ mode: 'recentlyAdded' }, 'recentlyAdded')).toEqual({ mode: 'recentlyAdded', dir: 'asc' })
  })

  it('never stores a direction for manual, from any state', () => {
    expect(nextSidebarSort({ mode: 'name', dir: 'desc' }, 'manual')).toEqual({ mode: 'manual' })
    expect(nextSidebarSort(undefined, 'manual')).toEqual({ mode: 'manual' })
  })

  it('re-clicking manual after manual stays manual without dir', () => {
    expect(nextSidebarSort({ mode: 'manual' }, 'manual')).toEqual({ mode: 'manual' })
  })
})

describe('sortSidebarItems', () => {
  const items = [
    item('B shelf', 3, 300, 500),
    item('a shelf', 10, 100, 300),
    item('C shelf', 3, 200, 400),
  ]

  it('returns the exact array (manual rank) for manual and undefined', () => {
    expect(sortSidebarItems(items, undefined)).toBe(items)
    expect(sortSidebarItems(items, { mode: 'manual' })).toBe(items)
  })

  it('does not mutate the input', () => {
    const before = [...items]
    sortSidebarItems(items, { mode: 'name' })
    expect(items).toEqual(before)
  })

  it('sorts by name with localeCompare, honouring dir', () => {
    expect(sortSidebarItems(items, { mode: 'name' }).map((i) => i.name)).toEqual(['a shelf', 'B shelf', 'C shelf'])
    expect(sortSidebarItems(items, { mode: 'name', dir: 'desc' }).map((i) => i.name)).toEqual(['C shelf', 'B shelf', 'a shelf'])
  })

  it('sorts by bookCount, ties keep manual order (stable)', () => {
    const desc = sortSidebarItems(items, { mode: 'bookCount' })
    expect(desc.map((i) => i.name)).toEqual(['a shelf', 'B shelf', 'C shelf'])
    const asc = sortSidebarItems(items, { mode: 'bookCount', dir: 'asc' })
    // B/C tie at 3: original relative order preserved by Array#sort stability
    expect(asc.map((i) => i.name)).toEqual(['B shelf', 'C shelf', 'a shelf'])
  })

  it('sorts by createdAt / updatedAt', () => {
    expect(sortSidebarItems(items, { mode: 'recentlyAdded' }).map((i) => i.name)).toEqual(['B shelf', 'C shelf', 'a shelf'])
    expect(sortSidebarItems(items, { mode: 'recentlyUpdated', dir: 'asc' }).map((i) => i.name)).toEqual(['a shelf', 'C shelf', 'B shelf'])
  })

  it('leads pinned items in every mode, ordered by the same rules within each group', () => {
    const withPins = [
      item('B shelf', 3, 300, 500),
      item('a shelf', 10, 100, 300, true),
      item('C shelf', 3, 200, 400, true),
    ]
    // manual: pinned group first, server order within groups
    expect(sortSidebarItems(withPins, undefined).map((i) => i.name)).toEqual(['a shelf', 'C shelf', 'B shelf'])
    // name desc applies inside both groups
    expect(sortSidebarItems(withPins, { mode: 'name', dir: 'desc' }).map((i) => i.name)).toEqual(['C shelf', 'a shelf', 'B shelf'])
    // no pins at all → plain mode sorting unchanged, manual still identity
    expect(sortSidebarItems(items, { mode: 'name' }).map((i) => i.name)).toEqual(['a shelf', 'B shelf', 'C shelf'])
    expect(sortSidebarItems(items, undefined)).toBe(items)
  })
})

describe('default direction maps', () => {
  it('covers every mode/field with the documented defaults', () => {
    expect(SIDEBAR_DEFAULT_DIR).toEqual({ name: 'asc', bookCount: 'desc', recentlyAdded: 'desc', recentlyUpdated: 'desc' })
    expect(BOOK_SORT_DEFAULT_DIR).toEqual({
      createdAt: 'desc',
      title: 'asc',
      author: 'asc',
      size: 'desc',
      progress: 'desc',
      lastReadAt: 'desc',
    })
  })
})
