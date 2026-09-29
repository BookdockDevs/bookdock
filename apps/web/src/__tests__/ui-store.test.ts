import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  vi.resetModules()
  const mod = await import('@/stores/ui.store')
  return mod.useUiStore
}

beforeEach(() => localStorage.clear())

describe('ui.store current preferences', () => {
  it('uses the default cover fit', async () => {
    const store = await freshStore()
    expect(store.getState().coverFit).toBe('crop')
  })

  it('restores a stored cover fit', async () => {
    localStorage.setItem('bd-cover-fit', 'full')
    const store = await freshStore()
    expect(store.getState().coverFit).toBe('full')
  })
})

describe('ui.store resetUserScopedPrefs', () => {
  it('returns server-owned preferences to their defaults', async () => {
    const store = await freshStore()
    store.getState().setCoverFit('full')
    store.getState().setTtsVoiceId('voice-7')
    store.getState().setReadingTimerMode('off')
    store.getState().setFontSize(26)
    store.getState().setCustomThemes([{ id: 't1', name: 'Theme', colors: { bg: '#fff', fg: '#000', primary: '#00f' } }])

    store.getState().resetUserScopedPrefs()

    expect(store.getState().coverFit).toBe('crop')
    expect(store.getState().ttsVoiceId).toBe('')
    expect(store.getState().readingTimerMode).toBe('auto')
    expect(store.getState().fontSize).toBe(18)
    expect(store.getState().customThemes).toEqual([])
  })

  it('keeps device-adaptation preferences, which describe the screen not the reader', async () => {
    const store = await freshStore()
    store.getState().setSidebarWidth(480)
    store.getState().setGridColumns('4')
    store.getState().setLibraryPageSize(96)
    store.getState().setToolbarLocked(true)

    store.getState().resetUserScopedPrefs()

    expect(store.getState().sidebarWidth).toBe(480)
    expect(store.getState().gridColumns).toBe('4')
    expect(store.getState().libraryPageSize).toBe(96)
    expect(store.getState().toolbarLocked).toBe(true)
  })

  it('resets preset values while keeping the presets themselves', async () => {
    const store = await freshStore()
    store.getState().createReadingPreset('护眼')
    store.getState().setFontSize(30)

    store.getState().resetUserScopedPrefs()

    const config = JSON.parse(store.getState().readingConfig) as { global: { fontSize: number }; presets: Array<{ name: string; snapshot: { fontSize: number } }> }
    expect(config.presets.map((preset) => preset.name)).toEqual(['护眼'])
    expect(config.global.fontSize).toBe(18)
    expect(config.presets[0]!.snapshot.fontSize).toBe(18)
    expect(store.getState().fontSize).toBe(18)
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
