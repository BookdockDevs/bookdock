import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  vi.resetModules()
  const mod = await import('@/stores/ui.store')
  return mod.useUiStore
}

beforeEach(() => localStorage.clear())

describe('ui.store cover prefs migration', () => {
  it('defaults to card text shown with crop fit', async () => {
    const store = await freshStore()
    expect(store.getState().coverText).toBe(true)
    expect(store.getState().coverFit).toBe('crop')
  })

  it.each([
    ['none', false, 'crop'],
    ['crop', true, 'crop'],
    ['full', true, 'full'],
  ] as const)('maps legacy bd-cover-style=%s to coverText=%s + coverFit=%s', async (style, text, fit) => {
    localStorage.setItem('bd-cover-style', style)
    const store = await freshStore()
    expect(store.getState().coverText).toBe(text)
    expect(store.getState().coverFit).toBe(fit)
  })

  it('maps the older boolean pair when no enum key exists', async () => {
    localStorage.setItem('bd-cover-mode', 'true')
    localStorage.setItem('bd-cover-fit', 'true')
    const store = await freshStore()
    expect(store.getState().coverText).toBe(false)
    expect(store.getState().coverFit).toBe('full')
  })

  it('new keys win over every legacy key', async () => {
    localStorage.setItem('bd-cover-text', 'false')
    localStorage.setItem('bd-cover-fit', 'full')
    localStorage.setItem('bd-cover-style', 'crop')
    localStorage.setItem('bd-cover-mode', 'false')
    const store = await freshStore()
    expect(store.getState().coverText).toBe(false)
    expect(store.getState().coverFit).toBe('full')
  })
})

describe('ui.store recentlyReadStyle migration', () => {
  it('defaults to off', async () => {
    const store = await freshStore()
    expect(store.getState().recentlyReadStyle).toBe('off')
  })

  it('maps bd-show-recently-read=true to cards', async () => {
    localStorage.setItem('bd-show-recently-read', 'true')
    const store = await freshStore()
    expect(store.getState().recentlyReadStyle).toBe('cards')
  })

  it('maps bd-show-recently-read=false to off', async () => {
    localStorage.setItem('bd-show-recently-read', 'false')
    const store = await freshStore()
    expect(store.getState().recentlyReadStyle).toBe('off')
  })

  it('the new key wins over the legacy boolean', async () => {
    localStorage.setItem('bd-recently-read-style', 'covers')
    localStorage.setItem('bd-show-recently-read', 'false')
    const store = await freshStore()
    expect(store.getState().recentlyReadStyle).toBe('covers')
  })
})
