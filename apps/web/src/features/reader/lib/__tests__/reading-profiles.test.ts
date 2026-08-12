import { describe, expect, it } from 'vitest'

import {
  READING_PROFILE_KEYS,
  activeSnapshot,
  createReadingPreset,
  deleteReadingPreset,
  emptyConfig,
  foldReadingChange,
  nextPresetName,
  parseReadingConfig,
  pickReadingSnapshot,
  renameReadingPreset,
  serializeReadingConfig,
  type ReadingConfig,
  type ReadingPreset,
} from '../reading-profiles'

function snapshot(overrides: Record<string, unknown> = {}): ReturnType<typeof pickReadingSnapshot> {
  return pickReadingSnapshot({ fontSize: 18, readingMode: 'scroll', ...overrides })
}

function configWith(preset: ReadingPreset): ReadingConfig {
  return { global: snapshot({ fontSize: 16 }), presets: [preset], active: null }
}

describe('reading profiles', () => {
  it('covers every reading-menu setting (40 keys)', () => {
    expect(READING_PROFILE_KEYS).toHaveLength(40)
    expect(READING_PROFILE_KEYS).toContain('fontSize')
    expect(READING_PROFILE_KEYS).toContain('scrollPageWidth')
    expect(READING_PROFILE_KEYS).toContain('clickAreaMode')
  })

  it('parses and round-trips a config', () => {
    const cfg = configWith({ id: 'p1', name: '护眼', snapshot: snapshot({ fontSize: 22 }) })
    const raw = serializeReadingConfig(cfg)
    expect(parseReadingConfig(raw)).toEqual(cfg)
  })

  it('returns null for corrupt or missing payloads', () => {
    expect(parseReadingConfig(null)).toBeNull()
    expect(parseReadingConfig('')).toBeNull()
    expect(parseReadingConfig('not json')).toBeNull()
    expect(parseReadingConfig('{"presets":[]}')).toBeNull()
    expect(parseReadingConfig('{"global":null}')).toBeNull()
  })

  it('drops malformed presets but keeps valid ones', () => {
    const cfg = parseReadingConfig(JSON.stringify({
      global: snapshot(),
      presets: [{ id: 'ok', name: '好', snapshot: snapshot() }, { id: 'bad' }, null],
      active: 'ok',
    }))
    expect(cfg?.presets).toHaveLength(1)
    expect(cfg?.active).toBe('ok')
  })

  it('creates a preset from a snapshot and activates it', () => {
    const next = createReadingPreset(configWith({ id: 'p1', name: 'x', snapshot: snapshot() }), '护眼', snapshot({ fontSize: 20 }))
    expect(next.presets).toHaveLength(2)
    expect(next.active).toBe(next.presets[1].id)
  })

  it('renames a preset in place', () => {
    const next = renameReadingPreset(configWith({ id: 'p1', name: 'old', snapshot: snapshot() }), 'p1', 'new')
    expect(next.presets[0].name).toBe('new')
  })

  it('deleting the active preset falls back to global', () => {
    const cfg = { ...configWith({ id: 'p1', name: 'x', snapshot: snapshot() }), active: 'p1' }
    const next = deleteReadingPreset(cfg, 'p1')
    expect(next.presets).toHaveLength(0)
    expect(next.active).toBeNull()
  })

  it('deleting an inactive preset keeps the active pointer', () => {
    const cfg = {
      global: snapshot(),
      presets: [
        { id: 'p1', name: 'a', snapshot: snapshot() },
        { id: 'p2', name: 'b', snapshot: snapshot() },
      ],
      active: 'p1',
    }
    const next = deleteReadingPreset(cfg, 'p2')
    expect(next.active).toBe('p1')
    expect(next.presets.map((p) => p.id)).toEqual(['p1'])
  })

  it('folds changes into the active preset when one is active', () => {
    const preset = { id: 'p1', name: 'x', snapshot: snapshot({ fontSize: 20 }) }
    const cfg = { ...configWith(preset), active: 'p1' }
    const next = foldReadingChange(cfg, 'fontSize', 24)
    expect(next.presets[0].snapshot.fontSize).toBe(24)
    expect(next.global.fontSize).toBe(16)
  })

  it('folds changes into the global config otherwise', () => {
    const next = foldReadingChange(configWith({ id: 'p1', name: 'x', snapshot: snapshot() }), 'fontSize', 19)
    expect(next.global.fontSize).toBe(19)
    expect(next.presets[0].snapshot.fontSize).toBe(18)
  })

  it('resolves the active snapshot from the preset or the global config', () => {
    const preset = { id: 'p1', name: 'x', snapshot: snapshot({ fontSize: 20 }) }
    expect(activeSnapshot({ ...configWith(preset), active: 'p1' }).fontSize).toBe(20)
    expect(activeSnapshot(configWith(preset)).fontSize).toBe(16)
  })

  it('auto-names new presets without collision', () => {
    const cfg = configWith({ id: 'p1', name: '预设 1', snapshot: snapshot() })
    expect(nextPresetName(cfg, '预设')).toBe('预设 2')
  })

  it('starts with an empty config', () => {
    const cfg = emptyConfig(snapshot({ fontSize: 15 }))
    expect(cfg.presets).toEqual([])
    expect(cfg.active).toBeNull()
    expect(cfg.global.fontSize).toBe(15)
  })
})
