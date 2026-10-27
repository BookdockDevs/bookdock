import { createBrowserHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LeaveEditorDialog from '../components/LeaveEditorDialog'
import { useDraftNavigationGuard } from './useDraftNavigationGuard'

describe('editor navigation guard', () => {
  it('uses the router blocker and waits for draft preservation before leaving', async () => {
    let finish!: (value: boolean) => void
    const preserve = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const discard = vi.fn(async () => true)
    const nativeConfirm = vi.spyOn(window, 'confirm')
    function Editor() {
      const navigation = useDraftNavigationGuard(true, false, 'book')
      return <><button onClick={navigation.back}>返回</button>{navigation.blocked && <LeaveEditorDialog saving={false}
        preserve={preserve} discard={discard} onLeave={() => navigation.proceed?.()} onClose={() => navigation.reset?.()} />}</>
    }
    const root = createRootRoute({ component: () => <Outlet /> })
    const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Home</p> })
    const editor = createRoute({ getParentRoute: () => root, path: '/editor', component: Editor })
    window.history.replaceState(null, '', '/')
    const router = createRouter({ routeTree: root.addChildren([home, editor]), history: createBrowserHistory() })
    await router.load()
    await router.navigate({ to: '/editor' })
    render(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: '返回' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留草稿并离开' }))
    expect(preserve).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe('/editor')
    expect(nativeConfirm).not.toHaveBeenCalled()
    await act(async () => finish(true))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    nativeConfirm.mockRestore()
  })
})
