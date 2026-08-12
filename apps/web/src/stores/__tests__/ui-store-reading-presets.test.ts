import { beforeEach, describe, expect, it } from 'vitest'

import { useUiStore } from '@/stores/ui.store'
import { parseReadingConfig, READING_PROFILE_KEYS } from '@/features/reader/lib/reading-profiles'

// Snapshot the store right after module load (jsdom defaults + seeded config);
// tests restore this baseline to stay independent of each other.
const baseline = useUiStore.getState()

function currentConfig() {
  return parseReadingConfig(useUiStore.getState().readingConfig)!
}

describe('ui.store reading preset routing', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset the config first — the routing subscription skips updates where
    // readingConfig changed — then everything else folds back idempotently
    // into the (baseline-seeded) global snapshot.
    useUiStore.setState({ readingConfig: baseline.readingConfig })
    useUiStore.setState(baseline)
  })

  it('creating a preset activates a snapshot of the current values', () => {
    const before = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    const cfg = currentConfig()
    expect(cfg.presets).toHaveLength(1)
    expect(cfg.active).toBe(cfg.presets[0].id)
    expect(cfg.presets[0].name).toBe('护眼')
    expect(cfg.presets[0].snapshot.fontSize).toBe(before)
  })

  it('creating a preset snapshots every current setting (all 40 keys)', () => {
    const state = useUiStore.getState()
    // Nudge a few representative settings away from their defaults first
    state.setFontSize(26)
    state.setLineHeight(1.8)
    state.setReadingMode('page')
    useUiStore.getState().createReadingPreset('全量')
    const snapshot = currentConfig().presets[0].snapshot
    const after = useUiStore.getState()
    for (const key of READING_PROFILE_KEYS) {
      expect(snapshot[key]).toBe(after[key])
    }
  })

  it('creating while another preset is active copies the displayed (preset) values', () => {
    const state = useUiStore.getState()
    state.createReadingPreset('A')
    state.setFontSize(30)
    useUiStore.getState().createReadingPreset('B')
    const cfg = currentConfig()
    const b = cfg.presets.find((p) => p.name === 'B')!
    expect(b.snapshot.fontSize).toBe(30)
    expect(cfg.active).toBe(b.id)
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

  it('edits while a preset is active fold into the preset, not the global config', () => {
    useUiStore.getState().createReadingPreset('护眼')
    const globalSizeBefore = currentConfig().global.fontSize
    const presetId = currentConfig().active!
    const nextSize = useUiStore.getState().fontSize + 4
    useUiStore.getState().setFontSize(nextSize)
    const cfg = currentConfig()
    expect(cfg.presets.find((p) => p.id === presetId)!.snapshot.fontSize).toBe(nextSize)
    expect(cfg.global.fontSize).toBe(globalSizeBefore)
  })

  it('activate/deactivate switches the flat values between preset and global', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    const presetId = currentConfig().active!
    useUiStore.getState().setFontSize(30)
    expect(useUiStore.getState().fontSize).toBe(30)

    useUiStore.getState().activateReadingPreset(null)
    expect(useUiStore.getState().fontSize).toBe(globalSize)

    useUiStore.getState().activateReadingPreset(presetId)
    expect(useUiStore.getState().fontSize).toBe(30)
  })

  it('deleting the active preset falls back to the global values', () => {
    const globalSize = useUiStore.getState().fontSize
    useUiStore.getState().createReadingPreset('护眼')
    useUiStore.getState().setFontSize(30)
    useUiStore.getState().deleteReadingPreset(currentConfig().active!)
    expect(useUiStore.getState().fontSize).toBe(globalSize)
    expect(currentConfig().active).toBeNull()
    expect(currentConfig().presets).toHaveLength(0)
  })

  it('global edits fold into the global snapshot while no preset is active', () => {
    const cfgBefore = currentConfig()
    useUiStore.getState().setFontSize(cfgBefore.global.fontSize + 2)
    expect(currentConfig().global.fontSize).toBe(cfgBefore.global.fontSize + 2)
  })

  it('reloads the last active preset state after a config-driven boot', () => {
    useUiStore.getState().createReadingPreset('护眼')
    useUiStore.getState().setFontSize(30)
    const savedRaw = useUiStore.getState().readingConfig
    // Simulate a fresh page load: only localStorage + module-level seed remain
    localStorage.clear()
    localStorage.setItem('bd-reading-config', savedRaw)
    const cfg = parseReadingConfig(localStorage.getItem('bd-reading-config'))!
    expect(cfg.active).not.toBeNull()
    expect(cfg.presets[0].snapshot.fontSize).toBe(30)
  })
})
