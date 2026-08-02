import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import type { AnnotationRes } from '@bookdock/shared'

import { useNotesFilter } from '../features/reader/hooks/useNotesFilter'

function makeAnnotation(overrides: Partial<AnnotationRes>): AnnotationRes {
  return {
    id: 'x',
    bookId: 'book-1',
    cfiRange: 'cfi:0',
    cfiAnchor: null,
    type: 'highlight',
    color: 'yellow',
    style: 'underline',
    text: '',
    note: null,
    chapter: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const ITEMS: AnnotationRes[] = [
  makeAnnotation({ id: 'h1', text: '直线划线甲', color: 'yellow', style: 'underline' }),
  makeAnnotation({ id: 'h2', text: '波浪划线乙', color: 'red', style: 'squiggly' }),
  makeAnnotation({ id: 'n1', type: 'note', text: '想法原文丙', note: '我的想法丙', color: 'blue', style: 'highlight' }),
  makeAnnotation({ id: 'b1', type: 'bookmark', text: '书签丁' }),
]

describe('useNotesFilter', () => {
  it('returns all items by default', () => {
    const { result } = renderHook(() => useNotesFilter(ITEMS))
    expect(result.current.filtered).toHaveLength(4)
    expect(result.current.sort).toBe('chapter')
    expect(result.current.hasActiveFilter).toBe(false)
  })

  it('limits the list to the given display types', () => {
    const { result } = renderHook(() => useNotesFilter(ITEMS, new Set(['idea'])))
    expect(result.current.filtered.map((a) => a.id)).toEqual(['n1'])
  })

  it('filters by query across source text and note content', () => {
    const { result } = renderHook(() => useNotesFilter(ITEMS))
    act(() => result.current.setQuery('想法丙'))
    expect(result.current.filtered.map((a) => a.id)).toEqual(['n1'])
  })

  it('filters by style and color, never matching bookmarks', () => {
    const { result } = renderHook(() => useNotesFilter(ITEMS))
    act(() => result.current.toggleStyle('squiggly'))
    expect(result.current.filtered.map((a) => a.id)).toEqual(['h2'])
    act(() => result.current.toggleStyle('squiggly'))
    act(() => result.current.toggleColor('yellow'))
    // b1 is yellow too, but color filters only apply to marks
    expect(result.current.filtered.map((a) => a.id)).toEqual(['h1'])
  })

  it('resets filters and sort together', () => {
    const { result } = renderHook(() => useNotesFilter(ITEMS))
    act(() => {
      result.current.toggleColor('blue')
      result.current.setSort('time-desc')
    })
    act(() => result.current.reset())
    expect(result.current.filtered).toHaveLength(4)
    expect(result.current.sort).toBe('chapter')
    expect(result.current.hasActiveFilter).toBe(false)
  })
})
