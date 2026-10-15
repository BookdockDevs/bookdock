import { act } from 'react'
import { describe, expect, it } from 'vitest'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import type { LibrarySearch } from '@/routes/index'
import {
  searchExitTarget,
  searchSessionNavigation,
  submittedSearchPatch,
} from '@/features/library/library-search-state'

import { archiveEntryState } from '@/features/archive/archive-return'

const LIBRARY_SOURCE: LibrarySearch = { q: 'morning', shelf: 'shelf-1', page: 2 }

function buildRouter(history: ReturnType<typeof createMemoryHistory>) {
  const root = createRootRoute()
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as LibrarySearch,
    component: () => null,
  })
  const archive = createRoute({
    getParentRoute: () => root,
    path: 'archive',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => null,
  })
  return createRouter({ routeTree: root.addChildren([index, archive]), history })
}

describe('archiveEntryState', () => {
  it('snapshots the entry source and scroll when no record exists yet', () => {
    expect(archiveEntryState(LIBRARY_SOURCE, 321, undefined)).toEqual({
      archiveReturn: { search: LIBRARY_SOURCE, scrollTop: 321 },
    })
  })

  it('keeps the existing record when re-entering from inside the archive', () => {
    const previous = { search: { q: 'original' }, scrollTop: 100 }
    expect(archiveEntryState({ q: 'archive-view' }, 999, previous).archiveReturn).toBe(previous)
  })
})

describe('archive top-bar exit', () => {
  it('still exits to the entry source after overview, bookA and bookB moves', async () => {
    const history = createMemoryHistory({ initialEntries: ['/?q=morning&shelf=shelf-1&page=2'] })
    const router = buildRouter(history)
    await router.load()

    // Sidebar entry: record the source once (mirrors LibrarySidebar).
    await act(async () => {
      await router.navigate({
        to: '/archive',
        state: (previous) => ({ ...previous, ...archiveEntryState(LIBRARY_SOURCE, 321, previous.archiveReturn) }),
      })
    })

    // In-archive moves (overview, single book A, single book B) forward the
    // record instead of overwriting it — mirrors Archive.patch and the
    // archive Links, which push without touching the exit source.
    const moves = [{ tab: 'stats' }, { bookId: 'book-a' }, { bookId: 'book-b' }]
    for (const search of moves) {
      await act(async () => {
        await router.navigate({ to: '/archive', search, state: (previous) => ({ ...previous }) })
      })
    }
    expect(router.state.location.state.archiveReturn).toEqual({ search: LIBRARY_SOURCE, scrollTop: 321 })

    // Top-bar exit: replace back to the recorded source (mirrors Archive).
    const indexBeforeExit = history.location.state.__TSR_index
    const recorded = router.state.location.state.archiveReturn
    await act(async () => {
      if (recorded) await router.navigate({ to: '/', search: recorded.search, replace: true })
      else await router.navigate({ to: '/', replace: true })
    })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toMatchObject({ q: 'morning', shelf: 'shelf-1', page: 2 })
    // Replace, not push: exiting must not strand the bookB entry behind `/`.
    expect(history.location.state.__TSR_index).toBe(indexBeforeExit)
  })

  it('preserves the library search session across the exit so clearing restores it', async () => {
    const history = createMemoryHistory({ initialEntries: ['/?page=3'] })
    const router = buildRouter(history)
    await router.load()
    const plain = router.state.location.search as LibrarySearch

    // Submit a search on the library (real helper): pushes one entry with a
    // return snapshot pointing at the plain pre-search state.
    const submitted = searchSessionNavigation(
      router.state.location.search as LibrarySearch,
      submittedSearchPatch('morning', { shared: false, tags: [], categories: [] }),
      undefined,
      720,
    )
    await act(async () => {
      await router.navigate({ to: '/', ...submitted })
    })
    const searchEntry = router.state.location
    expect(searchEntry.search).toMatchObject({ q: 'morning' })
    const snapshot = searchEntry.state.librarySearchReturn
    expect(snapshot).toMatchObject({ search: plain, scrollTop: 720, back: true })

    // Sidebar entry into the archive from the search results (real helper):
    // the snapshot rides along untouched.
    const enteredSearch = searchEntry.search as LibrarySearch
    await act(async () => {
      await router.navigate({
        to: '/archive',
        state: (previous) => ({
          ...previous,
          ...archiveEntryState(enteredSearch, 321, previous.archiveReturn),
        }),
      })
    })
    expect(router.state.location.state.librarySearchReturn).toEqual(snapshot)

    // One in-archive move must not disturb either record.
    await act(async () => {
      await router.navigate({ to: '/archive', search: { bookId: 'book-a' }, state: (previous) => ({ ...previous }) })
    })
    expect(router.state.location.state.archiveReturn).toEqual({ search: enteredSearch, scrollTop: 321 })
    expect(router.state.location.state.librarySearchReturn).toEqual(snapshot)

    // Top-bar exit (mirrors Archive): explicit landing on the recorded
    // search, snapshot restored with back downgraded — the archive pushes
    // broke the snapshot's one-step-back assumption.
    const recorded = router.state.location.state.archiveReturn!
    const searchReturn = router.state.location.state.librarySearchReturn!
    await act(async () => {
      await router.navigate({
        to: '/',
        search: recorded.search,
        replace: true,
        state: (previous) => ({
          ...previous,
          archiveReturn: undefined,
          librarySearchReturn: { ...searchReturn, back: false },
        }),
      })
    })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toMatchObject({ q: 'morning' })
    expect(router.state.location.state.archiveReturn).toBeUndefined()
    expect(router.state.location.state.librarySearchReturn).toMatchObject({
      search: plain,
      scrollTop: 720,
      back: false,
    })

    // Clearing the search on the library (real helper) restores the
    // pre-search filters, page and scroll position.
    const restored = router.state.location.state.librarySearchReturn!
    expect(searchExitTarget(router.state.location.search as LibrarySearch, restored)).toEqual(plain)
  })

  it('falls back to the library home when entered with no record', async () => {
    const history = createMemoryHistory({ initialEntries: ['/archive?bookId=book-a'] })
    const router = buildRouter(history)
    await router.load()

    const recorded = router.state.location.state.archiveReturn
    expect(recorded).toBeUndefined()
    await act(async () => {
      if (recorded) await router.navigate({ to: '/', search: recorded.search, replace: true })
      else await router.navigate({ to: '/', replace: true })
    })
    expect(router.state.location.pathname).toBe('/')
  })
})
