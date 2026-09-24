import { describe, expect, it } from 'vitest'

import {
  CHAPTER_TITLE_DEFAULTS,
  READING_PROFILE_KEYS,
  createReadingPreset,
  deleteReadingPreset,
  emptyConfig,
  foldReadingChange,
  nextPresetName,
  parseReadingConfig,
  pickReadingSnapshot,
  renameReadingPreset,
  resolveSnapshot,
  serializeReadingConfig,
  type ReadingConfig,
  type ReadingPreset,
} from '../reading-profiles'

function snapshot(overrides: Record<string, unknown> = {}): ReturnType<typeof pickReadingSnapshot> {
  return pickReadingSnapshot({ ...CHAPTER_TITLE_DEFAULTS, fontSize: 18, readingMode: 'scroll', ...overrides })
}

function configWith(preset: ReadingPreset): ReadingConfig {
  return { global: snapshot({ fontSize: 16 }), presets: [preset] }
}

describe('reading profiles', () => {
  it('covers every reading-menu setting (45 keys)', () => {
    expect(READING_PROFILE_KEYS).toHaveLength(45)
    expect(READING_PROFILE_KEYS).toContain('readingThemeMode')
    expect(READING_PROFILE_KEYS).toContain('fontSize')
    expect(READING_PROFILE_KEYS).toContain('scrollPageWidth')
    expect(READING_PROFILE_KEYS).toContain('clickAreaMode')
    expect(READING_PROFILE_KEYS).toContain('chapterTitleBottomSpacing')
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
    }))
    expect(cfg?.presets).toHaveLength(1)
    expect(cfg?.presets[0].id).toBe('ok')
  })

  it('creates a preset without touching activation state', () => {
    const { config, preset } = createReadingPreset(
      configWith({ id: 'p1', name: 'x', snapshot: snapshot() }),
      '护眼',
      snapshot({ fontSize: 20 }),
    )
    expect(config.presets).toHaveLength(2)
    expect(config.presets[1]).toEqual(preset)
    expect(preset.name).toBe('护眼')
    expect('active' in config).toBe(false)
  })

  it('renames a preset in place', () => {
    const next = renameReadingPreset(configWith({ id: 'p1', name: 'old', snapshot: snapshot() }), 'p1', 'new')
    expect(next.presets[0].name).toBe('new')
  })

  it('deletes a preset without touching activation state', () => {
    const cfg: ReadingConfig = {
      global: snapshot(),
      presets: [
        { id: 'p1', name: 'a', snapshot: snapshot() },
        { id: 'p2', name: 'b', snapshot: snapshot() },
      ],
    }
    const next = deleteReadingPreset(cfg, 'p2')
    expect(next.presets.map((p) => p.id)).toEqual(['p1'])
    expect('active' in next).toBe(false)
  })

  it('folds changes into the target preset when one is given', () => {
    const preset = { id: 'p1', name: 'x', snapshot: snapshot({ fontSize: 20 }) }
    const next = foldReadingChange(configWith(preset), 'fontSize', 24, 'p1')
    expect(next.presets[0].snapshot.fontSize).toBe(24)
    expect(next.global.fontSize).toBe(16)
  })

  it('folds changes into the global config without a target', () => {
    const next = foldReadingChange(configWith({ id: 'p1', name: 'x', snapshot: snapshot() }), 'fontSize', 19, null)
    expect(next.global.fontSize).toBe(19)
    expect(next.presets[0].snapshot.fontSize).toBe(18)
  })

  it('folds a dangling target into the global config (resolution fallback)', () => {
    const next = foldReadingChange(configWith({ id: 'p1', name: 'x', snapshot: snapshot() }), 'fontSize', 19, 'gone')
    expect(next.global.fontSize).toBe(19)
  })

  it('resolves the snapshot from the preset or the global config', () => {
    const preset = { id: 'p1', name: 'x', snapshot: snapshot({ fontSize: 20 }) }
    expect(resolveSnapshot(configWith(preset), 'p1').fontSize).toBe(20)
    expect(resolveSnapshot(configWith(preset), null).fontSize).toBe(16)
    expect(resolveSnapshot(configWith(preset), 'gone').fontSize).toBe(16)
  })

  it('auto-names new presets without collision', () => {
    const cfg = configWith({ id: 'p1', name: '预设 1', snapshot: snapshot() })
    expect(nextPresetName(cfg, '预设')).toBe('预设 2')
  })

  it('starts with an empty config', () => {
    const cfg = emptyConfig(snapshot({ fontSize: 15 }))
    expect(cfg.presets).toEqual([])
    expect(cfg.global.fontSize).toBe(15)
  })
})
