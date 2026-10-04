import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import type { LibrarySearch } from '@/routes/index'

import { keepsSearchSession, searchExitTarget, searchSessionNavigation, submittedSearchPatch } from './library-search-state'
import { pageRangeCorrection } from './library-filters'

const names = { shared: false, tags: [], categories: [] }

describe('library search session navigation', () => {
  it('retains the return state while paging or sorting search results, and ends it for sidebar changes', () => {
    expect(keepsSearchSession({ page: 2 })).toBe(true)
    expect(keepsSearchSession({ sortBy: 'title', sortOrder: 'asc', page: undefined })).toBe(true)
    expect(keepsSearchSession({ view: 'list' })).toBe(true)
    expect(keepsSearchSession({ shelf: 'new-shelf' })).toBe(false)
    expect(keepsSearchSession({ libraryId: 'other-library' })).toBe(false)
  })
  it('does not clamp the restored third page using placeholder search results', () => {
    expect(pageRangeCorrection(5, 3, 1, false, true)).toEqual({})
    expect(pageRangeCorrection(5, 3, 1, true, false)).toEqual({})
    expect(pageRangeCorrection(65, 3, 3, false, false)).toEqual({})
    expect(pageRangeCorrection(5, 3, 1, false, false)).toEqual({ page: undefined })
  })
  it('keeps ordinary keywords on the existing search path and quoted operators literal', () => {
    expect(submittedSearchPatch('two ordinary words', names)).toMatchObject({ q: 'two ordinary words', expression: undefined, page: undefined })
    expect(submittedSearchPatch('"tag:literal"', names).expression).toBeDefined()
    expect(submittedSearchPatch('word format:txt', names)).toMatchObject({ q: undefined, format: undefined })
  })
  it('preserves one return snapshot and one history entry across live queries and refresh', async () => {
    const history = createMemoryHistory({ initialEntries: ['/?page=3&shelf=shelf&tag=tag'] })
    const root = createRootRoute()
    const index = createRoute({ getParentRoute: () => root, path: '/', validateSearch: (search) => search as LibrarySearch })
    const router = createRouter({ routeTree: root.addChildren([index]), history })
    await router.load()
    const before = router.state.location.search as LibrarySearch
    const beforeIndex = history.location.state.__TSR_index
    const first = searchSessionNavigation(before, submittedSearchPatch('word', names), undefined, 720)
    await router.navigate({ to: '/', ...first })
    expect(history.location.state.__TSR_index).toBe(beforeIndex + 1)
    expect(router.state.location.search.page).toBeUndefined()
    const snapshot = router.state.location.state.librarySearchReturn!
    const second = searchSessionNavigation(router.state.location.search as LibrarySearch, submittedSearchPatch('another word', names), snapshot, 10)
    await router.navigate({ to: '/', ...second })
    expect(history.location.state.__TSR_index).toBe(beforeIndex + 1)
    expect(router.state.location.state.librarySearchReturn).toEqual({ search: before, scrollTop: 720, back: true })
    expect(history.location.href).not.toContain('scrollTop')
    const refreshed = createRouter({ routeTree: root.addChildren([index]), history })
    await refreshed.load()
    expect(searchExitTarget(refreshed.state.location.search as LibrarySearch, refreshed.state.location.state.librarySearchReturn)).toEqual(before)
    history.back()
    await router.load()
    expect(router.state.location.search).toEqual(before)
    expect(history.location.state.__TSR_index).toBe(beforeIndex)
    expect(history.location.state.librarySearchReturn).toBeUndefined()
  })
  it('clears a copied search without clearing unrelated filters or using another library snapshot', () => {
    const linked: LibrarySearch = { libraryId: 'current', q: 'word', page: 2, shelf: 'shelf', tag: 'tag', format: 'txt' }
    const expected = { ...linked, q: undefined, expression: undefined, page: undefined }
    expect(searchExitTarget(linked)).toEqual(expected)
    expect(searchExitTarget(linked, { search: { libraryId: 'other', shelf: 'foreign' }, scrollTop: 200 })).toEqual(expected)
    const edited = searchSessionNavigation(linked, submittedSearchPatch('new word', names))
    expect(edited.state.librarySearchReturn.back).toBe(false)
    expect(edited.state.librarySearchReturn.search).toEqual(expected)
  })
})
