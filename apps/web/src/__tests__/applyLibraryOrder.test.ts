import { arrayMove } from '@dnd-kit/sortable'
import { describe, expect, it } from 'vitest'

import { applyLibraryOrder, applyShelfOrder } from '../features/library/dnd'

const row = (id: string) => ({ id })

describe('applyLibraryOrder', () => {
  it('keeps the base order when there is no manual order', () => {
    const base = [row('a'), row('b'), row('c')]
    expect(applyLibraryOrder(base, undefined)).toEqual(base)
    expect(applyLibraryOrder(base, [])).toEqual(base)
  })

  it('puts the manual order first, in the order the reader dragged', () => {
    const base = [row('a'), row('b'), row('c')]
    expect(applyLibraryOrder(base, ['c', 'a'])).toEqual([row('c'), row('a'), row('b')])
  })

  it('appends libraries the order does not mention, so new joins land last', () => {
    // 'd' was joined after the last drag: the reader's order cannot mention it,
    // and the all-or-nothing rule shelves use would throw the whole thing away.
    const base = [row('a'), row('b'), row('c'), row('d')]
    expect(applyLibraryOrder(base, ['c', 'a'])).toEqual([row('c'), row('a'), row('b'), row('d')])
  })

  it('drops ids the reader no longer belongs to', () => {
    const base = [row('a'), row('b')]
    expect(applyLibraryOrder(base, ['gone', 'b'])).toEqual([row('b'), row('a')])
    // A stale id that matches nothing at all is not a reason to reshuffle.
    expect(applyLibraryOrder(base, ['gone'])).toEqual(base)
  })

  it('does not mutate the base list', () => {
    const base = [row('a'), row('b')]
    applyLibraryOrder(base, ['b'])
    expect(base.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('applyShelfOrder', () => {
  it('discards a partial order, which is why libraries cannot use it', () => {
    const base = [row('a'), row('b'), row('c')]
    expect(applyShelfOrder(base, ['c'])).toEqual(base)
  })
})

describe('reordering a list that is already manually ordered', () => {
  // The drag handler has to start from what the sidebar is showing. Starting
  // from the server's join order instead would silently discard the order the
  // reader had already arranged.
  it('moves within the displayed order, not the base order', () => {
    const base = [row('a'), row('b'), row('c')]
    const shown = applyLibraryOrder(base, ['c', 'a', 'b'])
    expect(shown.map((r) => r.id)).toEqual(['c', 'a', 'b'])

    // 'a' sits at index 1 on screen and is dragged to the top.
    const ordered = shown.map((r) => r.id)
    const next = arrayMove(ordered, ordered.indexOf('a'), 0)
    expect(next).toEqual(['a', 'c', 'b'])
  })
})
