import { describe, expect, it } from 'vitest'

import type { ShelfListItem, TagListItem } from '@bookdock/shared'

import { applyShelfOrder, applyTagOrder, isBookDrag, resolveDropShelfId, SHELF_NONE_DROPPABLE } from '../features/library/dnd'

function shelf(id: string, name: string): ShelfListItem {
  return { id, userId: 'u1', name, sortOrder: 0, createdAt: 0, updatedAt: 0, pinned: false, bookCount: 0 }
}

function tag(id: string, name: string): TagListItem {
  return { id, userId: 'u1', name, sortOrder: 0, createdAt: 0, updatedAt: 0, pinned: false, bookCount: 0 }
}

describe('dnd helpers', () => {
  it('recognizes a book drag payload', () => {
    expect(isBookDrag({ bookIds: ['b1'] })).toBe(true)
    expect(isBookDrag({ bookIds: [] })).toBe(false)
    expect(isBookDrag(null)).toBe(false)
    expect(isBookDrag(undefined)).toBe(false)
    expect(isBookDrag({ shelfIds: ['s1'] })).toBe(false)
  })

  it('resolves the uncategorized sentinel to null and shelf ids to themselves', () => {
    expect(resolveDropShelfId(SHELF_NONE_DROPPABLE)).toBeNull()
    expect(resolveDropShelfId('shelf-abc')).toBe('shelf-abc')
  })

  it('reorders the base list by the override', () => {
    const base = [shelf('a', 'A'), shelf('b', 'B'), shelf('c', 'C')]
    expect(applyShelfOrder(base, ['c', 'a', 'b']).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('returns the base list when the override is missing', () => {
    const base = [shelf('a', 'A')]
    expect(applyShelfOrder(base, null)).toBe(base)
    expect(applyShelfOrder(base, undefined)).toBe(base)
  })

  it('falls back to the base list when the override does not cover every shelf', () => {
    const base = [shelf('a', 'A'), shelf('b', 'B')]
    // A shelf created elsewhere refetched into the base but not the override.
    expect(applyShelfOrder([...base, shelf('c', 'C')], ['b', 'a']).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('reorders tags by the override and falls back when it is incomplete', () => {
    const base = [tag('a', 'A'), tag('b', 'B'), tag('c', 'C')]
    expect(applyTagOrder(base, ['c', 'a', 'b']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(applyTagOrder(base, ['b', 'a']).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
