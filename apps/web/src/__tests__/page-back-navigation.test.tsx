import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { useBackNavigation } from '@/hooks/useBackNavigation'

function BackButton() {
  const onBack = useBackNavigation('/')
  return (
    <button type="button" onClick={onBack}>
      go-back
    </button>
  )
}

// Minimal route tree mirroring the production shapes that matter here:
// archive keeps its search (filters, sort, selected book), the reader deep
// link carries ?annotation=, and every entry is an SPA push.
function buildRouter(history: ReturnType<typeof createMemoryHistory>) {
  const root = createRootRoute()
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => <div>home</div> })
  const archive = createRoute({
    getParentRoute: () => root,
    path: 'archive',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => <div>archive</div>,
  })
  const reader = createRoute({ getParentRoute: () => root, path: 'books/$id', component: BackButton })
  return createRouter({ routeTree: root.addChildren([index, archive, reader]), history })
}

async function openReaderFromArchive(router: AnyRouter) {
  await act(async () => {
    await router.navigate({ to: '/archive', search: { bookId: 'b1', bookType: 'all', bookSort: 'chapter' } })
  })
  await act(async () => {
    await router.navigate({ to: '/books/$id', params: { id: 'v1' }, search: { annotation: 'a1' } })
  })
  expect(await screen.findByText('go-back')).toBeInTheDocument()
}

afterEach(() => {
  cleanup()
})

describe('page-level back navigation', () => {
  it('returns from the reader to the archive entry with its search context intact', async () => {
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = buildRouter(history)
    await router.load()
    render(<RouterProvider router={router} />)

    await openReaderFromArchive(router)

    fireEvent.click(screen.getByText('go-back'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/archive'))
    expect(router.state.location.search).toMatchObject({ bookId: 'b1', bookType: 'all', bookSort: 'chapter' })
  })

  it('keeps the archive source across a same-tab refresh', async () => {
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const first = buildRouter(history)
    await first.load()
    const { unmount } = render(<RouterProvider router={first} />)

    await openReaderFromArchive(first)
    // A refresh reuses the same browser history entry (with its state).
    unmount()
    const refreshed = buildRouter(history)
    await refreshed.load()
    render(<RouterProvider router={refreshed} />)
    expect(await screen.findByText('go-back')).toBeInTheDocument()

    fireEvent.click(screen.getByText('go-back'))
    await waitFor(() => expect(refreshed.state.location.pathname).toBe('/archive'))
    expect(refreshed.state.location.search).toMatchObject({ bookId: 'b1' })
  })

  it('falls back with replace on direct entry, leaving no return loop behind', async () => {
    // Direct open / copied link / new tab: a single entry, no provable source.
    const history = createMemoryHistory({ initialEntries: ['/books/v1?annotation=a1'] })
    const router = buildRouter(history)
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('go-back')).toBeInTheDocument()

    fireEvent.click(screen.getByText('go-back'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    // Replace (not push): stepping back from the fallback must not reopen
    // the dead-end reader page.
    await act(async () => {
      history.back()
    })
    expect(router.state.location.pathname).toBe('/')
  })
})
