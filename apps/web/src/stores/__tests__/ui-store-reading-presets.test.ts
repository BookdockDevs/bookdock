import { beforeEach, describe, expect, it, vi } from 'vitest'

import { selectEffectiveHighlightRules, selectEffectiveReadingThemeId, selectEffectiveReadingCss, selectReaderThemeOverride, useUiStore } from '@/stores/ui.store'
import { parseReadingConfig, pickReadingPresetSnapshot, pickReadingSnapshot, serializeReadingConfig } from '@/features/reader/lib/reading-profiles'

// Snapshot the store right after module load (jsdom defaults + seeded config);
// tests restore this baseline to stay independent of each other.
const baseline = useUiStore.getState()

function currentConfig() {
  return parseReadingConfig(useUiStore.getState().readingConfig)!
}

describe('ui.store theme scope writes', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiStore.setState({ readingConfig: baseline.readingConfig })
    useUiStore.setState(baseline)
  })

  it('changing the theme while a preset is active updates the global theme only', () => {
    useUiStore.getState().createReadingPreset('P1')
    const preset = currentConfig().presets[0]!
    useUiStore.getState().setSystemTheme('light')
    useUiStore.getState().setReadingThemeId('cream')
    const cfg = currentConfig()
    // A pick fills the slot of the tone the reader is in; the mode is a
    // separate decision and stays on `system` so the device can still flip it.
    expect(cfg.global).toMatchObject({ readingThemeId: 'cream', lightReadingThemeId: 'cream', readingThemeMode: 'system' })
    expect(cfg.presets[0]).toEqual(preset)
    expect(useUiStore.getState().activePresetId).toBe(preset.id)
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('cream')
  })

  it('keeps system mode switching day and night after a daytime pick', () => {
    const store = useUiStore.getState()
    store.setReadingThemeMode('system')
    store.setSystemTheme('light')
    store.setGlobalReadingTheme('sepia', 'dark')
    store.setReadingThemeId('cream')
    expect(useUiStore.getState()).toMatchObject({ readingThemeMode: 'system', lightReadingThemeId: 'cream' })
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('cream')
    store.setSystemTheme('dark')
    expect(useUiStore.getState().readingThemeMode).toBe('system')
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('sepia')
    // A pick made while the device is dark lands on the night slot.
    store.setReadingThemeId('night')
    expect(useUiStore.getState()).toMatchObject({ darkReadingThemeId: 'night', lightReadingThemeId: 'cream', readingThemeMode: 'system' })
    store.setSystemTheme('light')
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('cream')
  })

  it('a manual day lock ignores the device turning dark', () => {
    const store = useUiStore.getState()
    store.setSystemTheme('light')
    store.setReadingThemeId('cream')
    store.setReadingThemeMode('light')
    store.setSystemTheme('dark')
    expect(useUiStore.getState().readingThemeMode).toBe('light')
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('cream')
  })

  it('switches legacy layout presets while preserving defaults and the single-book theme', () => {
    const legacy = {
      global: { ...currentConfig().global, readingThemeMode: 'light', lightReadingThemeId: 'cream', darkReadingThemeId: 'sepia' },
      presets: [{ id: 'legacy', name: 'Legacy', snapshot: { fontSize: 36, readingThemeMode: 'dark', darkReadingThemeId: 'night' } }],
    }
    useUiStore.setState({ readingConfig: JSON.stringify(legacy) })
    const store = useUiStore.getState()
    store.setReaderThemeOverride('book', 'paper')
    store.activateReadingPreset('legacy')
    expect(useUiStore.getState().fontSize).toBe(36)
    expect(useUiStore.getState()).toMatchObject({ readingThemeMode: 'light', lightReadingThemeId: 'cream', darkReadingThemeId: 'sepia' })
    expect(selectReaderThemeOverride(useUiStore.getState())?.id).toBe('paper')
    store.activateReadingPreset(null)
    expect(useUiStore.getState().fontSize).toBe(legacy.global.fontSize)
    expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('cream')
    expect(selectReaderThemeOverride(useUiStore.getState())?.id).toBe('paper')
  })

  it('saveCustomTheme writes the definition without changing the selection', () => {
    const before = useUiStore.getState().readingThemeId
    const beforeLight = useUiStore.getState().lightReadingThemeId
    useUiStore.getState().saveCustomTheme({ id: 'custom-t1', name: 'T', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: '#101820', outsideBg: '#050505' } })
    expect(useUiStore.getState().customThemes.some((t) => t.id === 'custom-t1')).toBe(true)
    expect(useUiStore.getState().readingThemeId).toBe(before)
    expect(useUiStore.getState().lightReadingThemeId).toBe(beforeLight)
  })

  it('trial and override session slots shadow the chain but never touch the config blob', () => {
    const before = useUiStore.getState().readingConfig
    const trial = { id: 'trial-draft', name: 'T', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: '#101820', outsideBg: '#050505' } }
    useUiStore.getState().setReaderThemeOverride('book-1', 'custom-missing')
    useUiStore.getState().setReaderThemeTrial('book-1', trial)
    // The trial shadows the override; a dangling override id falls back to null
    expect(selectReaderThemeOverride(useUiStore.getState())?.id).toBe('trial-draft')
    useUiStore.getState().setReaderThemeTrial(null, null)
    expect(selectReaderThemeOverride(useUiStore.getState())).toBeNull()
    // The persisted config blob is untouched by both slots
    expect(useUiStore.getState().readingConfig).toBe(before)
    useUiStore.getState().setReaderThemeOverride(null, null)
    expect(useUiStore.getState().readerThemeOverrideId).toBeNull()
  })
})

describe('ui.store effective reading CSS (phase 2)', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiStore.setState(baseline)
  })

  it('follows the effective theme and lets a trial draft carry CSS', () => {
    useUiStore.getState().saveCustomTheme({ id: 'css-src', name: 'Ink', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, contentCss: 'p { color: red }', uiCss: '[data-bd-ui="header"] { color: blue }' })
    useUiStore.getState().setReadingThemeId('css-src')
    expect(selectEffectiveReadingCss(useUiStore.getState()).contentCss).toBe('p { color: red }')
    // a trial draft carries CSS with its colors
    useUiStore.getState().setReaderThemeTrial('book-1', { id: 't', name: 'T', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, contentCss: 'p { margin: 2em }' })
    expect(selectEffectiveReadingCss(useUiStore.getState()).contentCss).toBe('p { margin: 2em }')
    useUiStore.getState().setReaderThemeTrial(null, null)
  })
})

describe('ui.store effective highlight rules (phase 3)', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiStore.setState(baseline)
  })

  const dialogueRule = { id: 'r1', name: '对白', pattern: '「[^」]*」', isRegex: true, enabled: true, style: { backgroundColor: '#F5E3B8' } }

  it('follows the effective theme chain and lets a trial draft carry rules', () => {
    useUiStore.getState().saveCustomTheme({ id: 'hl-src', name: 'Novel', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, highlightRules: [dialogueRule] })
    useUiStore.getState().setReadingThemeId('hl-src')
    expect(selectEffectiveHighlightRules(useUiStore.getState())).toEqual([dialogueRule])
    useUiStore.getState().setReaderThemeTrial('book-1', { id: 't', name: 'T', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, highlightRules: [dialogueRule] })
    expect(selectEffectiveHighlightRules(useUiStore.getState())).toEqual([dialogueRule])
    useUiStore.getState().setReaderThemeTrial(null, null)
  })
})

describe('ui.store reading preset routing', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset the config first — the routing subscription skips updates where
    // readingConfig changed — then everything else folds back idempotently
    // into the (baseline-seeded) global snapshot.
    useUiStore.setState({ readingConfig: baseline.readingConfig })
    useUiStore.setState(baseline)
  })

  it('creating a preset snapshots the current values and activates it on this device', () => {
    const before = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    const cfg = currentConfig()
    expect(cfg.presets).toHaveLength(1)
    expect(cfg.presets[0].name).toBe('护眼')
    expect(cfg.presets[0].snapshot.fontSize).toBe(before)
    // Activation is device-local: the blob carries no pointer
    expect('active' in cfg).toBe(false)
    expect(useUiStore.getState().activePresetId).toBe(cfg.presets[0].id)
  })

  it('creating a preset snapshots layout and behavior without theme defaults', () => {
    const state = useUiStore.getState()
    // Nudge a few representative settings away from their defaults first
    state.setFontSize(26)
    state.setLineHeight(1.8)
    state.setReadingMode('page')
    useUiStore.getState().createReadingPreset('全量')
    const snapshot = currentConfig().presets[0].snapshot
    const after = pickReadingSnapshot(useUiStore.getState())
    expect(snapshot).toEqual(pickReadingPresetSnapshot(after))
    expect(snapshot).not.toHaveProperty('lightReadingThemeId')
    expect(snapshot).not.toHaveProperty('darkReadingThemeId')
    expect(snapshot).not.toHaveProperty('readingThemeMode')
  })

  it('creating while another preset is active copies the displayed (preset) values', () => {
    const state = useUiStore.getState()
    state.createReadingPreset('A')
    state.setFontSize(30)
    useUiStore.getState().createReadingPreset('B')
    const cfg = currentConfig()
    const b = cfg.presets.find((p) => p.name === 'B')!
    expect(b.snapshot.fontSize).toBe(30)
    expect(useUiStore.getState().activePresetId).toBe(b.id)
  })

  it('creating with an active 仅本书 diff captures the overridden values', () => {
    const state = useUiStore.getState()
    state.setFontSize(18)
    useUiStore.getState().createReadingPreset('A', { fontSize: 22, scrollPageWidth: 900 })
    const cfg = currentConfig()
    const a = cfg.presets.find((p) => p.name === 'A')!
    expect(a.snapshot.fontSize).toBe(22)
    expect(a.snapshot.scrollPageWidth).toBe(900)
    // keys not in the per-book diff keep the active config's values
    expect(a.snapshot.lineHeight).toBe(state.lineHeight)
  })

  it('a preset created with an active 仅本书 diff is applied, not only shown active', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('A', { fontSize: 22 })
    const aId = useUiStore.getState().activePresetId!
    // Activation re-resolves the flat fields to the captured values; with the
    // book groups later disabled the preset applies, not the old global values
    expect(useUiStore.getState().fontSize).toBe(22)
    useUiStore.getState().applyReadingResolution()
    expect(useUiStore.getState().fontSize).toBe(22)
    useUiStore.getState().activateReadingPreset(null)
    expect(useUiStore.getState().fontSize).toBe(globalSize)
    useUiStore.getState().activateReadingPreset(aId)
    expect(useUiStore.getState().fontSize).toBe(22)
  })

  it('a preset captured under a per-book page mode keeps its width across mode round-trips', () => {
    // Global chain sits in scroll mode; the overlay pins page mode + width
    expect(useUiStore.getState().readingMode).toBe('scroll')
    useUiStore.getState().createReadingPreset('Page', { readingMode: 'page', pagePageWidth: 1250, pageWidth: 1250 })
    const cfg = currentConfig()
    const preset = cfg.presets[0]!
    expect(preset.snapshot.readingMode).toBe('page')
    // The mirror is re-derived for the snapshot's own mode, so it no longer
    // carries the scroll-mode width
    expect(preset.snapshot.pageWidth).toBe(1250)
    const scrollWidth = cfg.global.scrollPageWidth
    useUiStore.getState().activateReadingPreset(preset.id)
    expect(useUiStore.getState().readingMode).toBe('page')
    expect(useUiStore.getState().pageWidth).toBe(1250)
    // Round-tripping must not write the stale mirror into the other backing
    useUiStore.getState().setReadingMode('scroll')
    expect(useUiStore.getState().scrollPageWidth).toBe(scrollWidth)
    useUiStore.getState().setReadingMode('page')
    expect(useUiStore.getState().pagePageWidth).toBe(1250)
    expect(useUiStore.getState().pageWidth).toBe(1250)
  })

  it('edits while a preset is active fold into the preset, not the global config', () => {
    useUiStore.getState().createReadingPreset('护眼')
    const globalSizeBefore = currentConfig().global.fontSize
    const presetId = useUiStore.getState().activePresetId!
    const nextSize = useUiStore.getState().fontSize + 4
    useUiStore.getState().setFontSize(nextSize)
    const cfg = currentConfig()
    expect(cfg.presets.find((p) => p.id === presetId)!.snapshot.fontSize).toBe(nextSize)
    expect(cfg.global.fontSize).toBe(globalSizeBefore)
  })

  it('activate/deactivate switches the flat values between preset and global', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    const presetId = useUiStore.getState().activePresetId!
    useUiStore.getState().setFontSize(30)
    expect(useUiStore.getState().fontSize).toBe(30)

    useUiStore.getState().activateReadingPreset(null)
    expect(useUiStore.getState().fontSize).toBe(globalSize)

    useUiStore.getState().activateReadingPreset(presetId)
    expect(useUiStore.getState().fontSize).toBe(30)
  })

  it('persists the device active pointer in its own localStorage key', () => {
    useUiStore.getState().createReadingPreset('护眼')
    const presetId = useUiStore.getState().activePresetId!
    expect(localStorage.getItem('bd-reading-active-preset')).toBe(presetId)

    useUiStore.getState().activateReadingPreset(null)
    expect(localStorage.getItem('bd-reading-active-preset')).toBeNull()
  })

  it('deleting the active preset falls back to the global values', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    useUiStore.getState().setFontSize(30)
    useUiStore.getState().deleteReadingPreset(useUiStore.getState().activePresetId!)
    expect(useUiStore.getState().fontSize).toBe(globalSize)
    expect(useUiStore.getState().activePresetId).toBeNull()
    expect(currentConfig().presets).toHaveLength(0)
  })

  it('global edits fold into the global snapshot while no preset is active', () => {
    const cfgBefore = currentConfig()
    useUiStore.getState().setFontSize(cfgBefore.global.fontSize + 2)
    expect(currentConfig().global.fontSize).toBe(cfgBefore.global.fontSize + 2)
  })

  it('a bound preset heads the resolution chain while its book is open', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    const presetId = useUiStore.getState().activePresetId!
    useUiStore.getState().setFontSize(30)
    useUiStore.getState().activateReadingPreset(null)
    expect(useUiStore.getState().fontSize).toBe(globalSize)

    // Opening a book bound to the preset applies its snapshot
    useUiStore.getState().setBoundPresetId(presetId)
    useUiStore.getState().applyReadingResolution()
    expect(useUiStore.getState().fontSize).toBe(30)

    // Edits while bound fold into the bound preset even without a device active
    useUiStore.getState().setFontSize(34)
    expect(currentConfig().presets.find((p) => p.id === presetId)!.snapshot.fontSize).toBe(34)

    // Leaving the book falls back to the device chain (no active → global)
    useUiStore.getState().setBoundPresetId(null)
    useUiStore.getState().applyReadingResolution()
    expect(useUiStore.getState().fontSize).toBe(globalSize)
  })

  it('a dangling binding falls back to the device active at resolution', () => {
    useUiStore.getState().createReadingPreset('A')
    const aId = useUiStore.getState().activePresetId!
    useUiStore.getState().setFontSize(30)
    useUiStore.getState().createReadingPreset('B')
    useUiStore.getState().setFontSize(22)

    // Book bound to A while B is the device active: A wins
    useUiStore.getState().setBoundPresetId(aId)
    useUiStore.getState().applyReadingResolution()
    expect(useUiStore.getState().fontSize).toBe(30)

    // A is deleted on another device: the binding dangles and B applies
    useUiStore.getState().deleteReadingPreset(aId)
    expect(useUiStore.getState().fontSize).toBe(22)
  })

  it('clears a device active whose preset was deleted elsewhere', () => {
    useUiStore.getState().createReadingPreset('护眼')
    useUiStore.getState().setFontSize(30)
    const cfg = currentConfig()
    // Simulate a sync payload with the preset removed (deleted on another device)
    useUiStore.setState({ readingConfig: serializeReadingConfig({ global: cfg.global, presets: [] }) })
    useUiStore.getState().applyReadingResolution()
    expect(useUiStore.getState().activePresetId).toBeNull()
    expect(useUiStore.getState().fontSize).toBe(cfg.global.fontSize)
  })

  it('reloads the persisted blob after a config-driven boot', () => {
    useUiStore.getState().createReadingPreset('护眼')
    useUiStore.getState().setFontSize(30)
    const savedRaw = useUiStore.getState().readingConfig
    // Simulate a fresh page load: only localStorage + module-level seed remain
    localStorage.clear()
    localStorage.setItem('bd-reading-config', savedRaw)
    const cfg = parseReadingConfig(localStorage.getItem('bd-reading-config'))!
    expect(cfg.presets[0].snapshot.fontSize).toBe(30)
    expect('active' in cfg).toBe(false)
  })

  it('fills title settings in older global and preset snapshots', () => {
    const config = currentConfig()
    const global = { ...config.global }
    delete (global as Partial<typeof global>).chapterTitleSize
    const legacy = parseReadingConfig(JSON.stringify({ global, presets: [{ id: 'older', name: 'Older', snapshot: global }] }))!
    expect(legacy.global.chapterTitleSize).toBe(1.5)
    expect(legacy.presets[0].snapshot.chapterTitleSize).toBe(1.5)
  })
})

it('allows the dark palette on the daytime slot and a whole custom theme on the nighttime slot', () => {
  useUiStore.setState(baseline)
  const store = useUiStore.getState()
  store.saveCustomTheme({ id: 'ink', name: 'Ink', colors: { bg: '#fff', fg: '#000', primary: '#00f' }, contentCss: 'p { color: red }' })
  store.setReadingThemeMode('system')
  store.setSystemTheme('light')
  store.setGlobalReadingTheme('night', 'light')
  store.setGlobalReadingTheme('ink', 'dark')
  expect(useUiStore.getState().readingThemeMode).toBe('system')
  expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('night')
  store.setSystemTheme('dark')
  expect(selectEffectiveReadingThemeId(useUiStore.getState())).toBe('ink')
  expect(selectEffectiveReadingCss(useUiStore.getState()).contentCss).toBe('p { color: red }')
  expect(currentConfig().global).toMatchObject({ lightReadingThemeId: 'night', darkReadingThemeId: 'ink' })
})

it('restores saved reading presets and the active layout on startup before settings sync', async () => {
  localStorage.clear()
  try {
    localStorage.setItem('bd-read-font-size', '20')
    localStorage.setItem('bd-reading-config', JSON.stringify({
      global: { fontSize: 24 },
      presets: [{ id: 'saved-layout', name: 'Saved layout', snapshot: { fontSize: 31 } }],
    }))
    localStorage.setItem('bd-reading-active-preset', 'saved-layout')
    vi.resetModules()
    const { useUiStore: reloadedStore } = await import('@/stores/ui.store')
    const state = reloadedStore.getState()
    expect(parseReadingConfig(state.readingConfig)?.presets.map(({ name }) => name)).toEqual(['Saved layout'])
    expect(state.activePresetId).toBe('saved-layout')
    expect(state.fontSize).toBe(31)
  } finally {
    localStorage.clear()
  }
})
