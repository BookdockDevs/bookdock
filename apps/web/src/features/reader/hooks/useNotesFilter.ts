import { useEffect, useMemo, useState } from 'react'

import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

export type NoteSort = 'time-desc' | 'time-asc' | 'chapter' | 'chapter-desc'
export type ItemKind = 'bookmark' | 'idea' | 'highlight'

// Device-local, same shape as the display-type key the panel owns: a view
// preference belongs to the reader, not to the book, so it survives reopening
// the panel and navigating away and back.
const SORT_KEY = 'bd-notes-sort'
const ALL_SORTS: NoteSort[] = ['time-desc', 'time-asc', 'chapter', 'chapter-desc']

function loadSort(): NoteSort {
  try {
    const raw = window.localStorage.getItem(SORT_KEY)
    if (raw && ALL_SORTS.includes(raw as NoteSort)) return raw as NoteSort
  } catch {
    // ignore storage errors
  }
  return 'chapter'
}

export function kindOf(a: AnnotationRes): ItemKind {
  if (a.type === 'bookmark') return 'bookmark'
  return a.note?.trim() ? 'idea' : 'highlight'
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/**
 * Search/filter/sort state for the merged notes list, owned by NavigationPanel.
 * displayTypes (persisted by the caller) selects which kinds appear at all.
 */
export function useNotesFilter(items: AnnotationRes[], displayTypes?: Set<ItemKind>) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<NoteSort>(loadSort)
  const [styleFilter, setStyleFilter] = useState<Set<AnnotationStyle>>(new Set())
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_KEY, sort)
    } catch {
      // ignore storage errors
    }
  }, [sort])

  const filtered = useMemo(() => {
    let result = items
    if (displayTypes && displayTypes.size < 3) result = result.filter((a) => displayTypes.has(kindOf(a)))
    // Style/color describe the mark itself — bookmarks never match an active one
    if (styleFilter.size > 0) result = result.filter((a) => a.type !== 'bookmark' && styleFilter.has(a.style))
    if (colorFilter.size > 0) result = result.filter((a) => a.type !== 'bookmark' && colorFilter.has(a.color))
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      result = result.filter((a) => a.text.toLowerCase().includes(q) || a.note?.toLowerCase().includes(q))
    }
    return result
  }, [items, displayTypes, styleFilter, colorFilter, query])

  return {
    query,
    setQuery,
    sort,
    setSort,
    styleFilter,
    colorFilter,
    // Sort reorders, it does not select: counting it lit the filter icon and
    // the "filter active" dot for someone who only wanted a different order.
    // The search box, which really does hide rows, was the one missing here.
    hasActiveFilter: styleFilter.size > 0 || colorFilter.size > 0 || query.trim().length > 0,
    toggleStyle: (style: AnnotationStyle) => setStyleFilter((s) => toggleInSet(s, style)),
    toggleColor: (color: string) => setColorFilter((s) => toggleInSet(s, color)),
    reset: () => {
      // Deliberately leaves sort alone - it is not a filter, so resetting
      // filters has no business discarding the reader's chosen order.
      setStyleFilter(new Set())
      setColorFilter(new Set())
    },
    filtered,
  }
}
