import { describe, expect, it } from 'vitest'

import { orderResourceItems, type ResourcePreferences } from './resource-preferences'

interface Item { id: string; createdAt: number; sortOrder: number }

const items: Item[] = [
  { id: 'book-rule', createdAt: 10, sortOrder: 0 },
  { id: 'first', createdAt: 20, sortOrder: 1 },
  { id: 'second', createdAt: 30, sortOrder: 2 },
]

function order(preferences: ResourcePreferences): string[] {
  return orderResourceItems(items, preferences, (item) => item.sortOrder).map((item) => item.id)
}

describe('orderResourceItems', () => {
  it('uses the definition order when nothing was saved', () => {
    expect(order({ enabled: {}, order: [] })).toEqual(['book-rule', 'first', 'second'])
  })

  it('applies a complete saved order as the whole list order', () => {
    expect(order({ enabled: {}, order: ['second', 'first', 'book-rule'] })).toEqual(['second', 'first', 'book-rule'])
  })

  it('keeps an id outside the saved order in its definition slot', () => {
    // The settings list only shows global rules, so a book-scoped rule is never
    // part of the payload: reordering the globals must not move it.
    expect(order({ enabled: {}, order: ['second', 'first'] })).toEqual(['book-rule', 'second', 'first'])
  })

  it('ignores saved ids whose definition is gone instead of shifting the rest', () => {
    expect(order({ enabled: {}, order: ['deleted', 'second', 'first'] })).toEqual(['book-rule', 'second', 'first'])
  })
})
