import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  vi.resetModules()
  const mod = await import('@/stores/ui.store')
  return mod.useUiStore
}

beforeEach(() => localStorage.clear())

describe('ui.store current preferences', () => {
  it('uses the default cover preferences', async () => {
    const store = await freshStore()
    expect(store.getState().coverText).toBe(true)
    expect(store.getState().coverFit).toBe('crop')
  })

  it('restores current cover and recently-read preferences', async () => {
    localStorage.setItem('bd-cover-text', 'false')
    localStorage.setItem('bd-cover-fit', 'full')
    localStorage.setItem('bd-recently-read-style', 'covers')
    const store = await freshStore()
    expect(store.getState().coverText).toBe(false)
    expect(store.getState().coverFit).toBe('full')
    expect(store.getState().recentlyReadStyle).toBe('covers')
  })
})

describe('ui.store reader sidebar width', () => {
  it('restores the full width range offered by the resize handle', async () => {
    localStorage.setItem('bd-sidebar-width', '640')
    const store = await freshStore()
    expect(store.getState().sidebarWidth).toBe(640)
  })

  it('clamps stale widths to the resize bounds', async () => {
    localStorage.setItem('bd-sidebar-width', '900')
    const store = await freshStore()
    expect(store.getState().sidebarWidth).toBe(640)
  })
})
