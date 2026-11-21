import { describe, expect, it } from 'vitest'

import { highlightRulePreset, legacyThemeToDraft, resolveDraftColors } from '../features/reading-theme/draft'
import type { HighlightPresetKind } from '../features/reading-theme/draft'
import { computeHighlightSegments } from '../lib/highlight-match'

describe('resolveEffectiveReadingThemeId', () => {
  it('uses the remembered light theme when the system is light', () => {
    expect(resolveEffectiveReadingThemeId('system', 'light', 'cream')).toBe('cream')
  })

  it('uses night when the system is dark', () => {
    expect(resolveEffectiveReadingThemeId('system', 'dark', 'cream')).toBe('night')
  })

  it('keeps manual light and dark modes independent from the system', () => {
    expect(resolveEffectiveReadingThemeId('light', 'dark', 'sepia')).toBe('sepia')
    expect(resolveEffectiveReadingThemeId('dark', 'light', 'sepia')).toBe('night')
  })
})

import { customThemesFromSync, deriveReadingTheme, isHexColor, resolveEffectiveReadingTheme, resolveEffectiveReadingThemeId, resolveEffectiveHighlightRules, resolveEffectiveThemeCss, sanitizeHighlightRulesField, themeCssOf, type CustomReadingTheme } from '../lib/reading-theme'

describe('deriveReadingTheme', () => {
  it('keeps legacy themes on the single-canvas path', () => {
    const theme = deriveReadingTheme({ bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' })
    expect(theme.scrolled).toBeUndefined()
    // The derived canvas stays slightly darker than the chrome bg
    expect(theme.pageBg).not.toBe(theme.bg)
    expect(theme.text).toBe('#1c1917')
  })

  it('applies an explicit dual pair to the scrolled surfaces without touching chrome colors', () => {
    const theme = deriveReadingTheme({ bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e', pageBg: '#FFF8E7', outsideBg: '#2B2B2B' })
    expect(theme.scrolled).toEqual({ page: '#FFF8E7', outside: '#2B2B2B' })
    // The paper color becomes the page canvas for paginated/scrolled surfaces
    expect(theme.pageBg).toBe('#FFF8E7')
    expect(theme.bg).toBe('#F4F4F4')
    expect(theme.text).toBe('#1c1917')
    expect(theme.primary).toBe('#57534e')
  })
})

describe('editing legacy themes', () => {
  const legacy = { id: 'legacy', name: 'Legacy', colors: { bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' } }

  it('keeps the original theme colors when the legacy draft is saved untouched', () => {
    expect(resolveDraftColors(legacyThemeToDraft(legacy))).toEqual(legacy.colors)
  })

  it('uses the new dual colors when a background changes', () => {
    const draft = legacyThemeToDraft(legacy)
    const edited = { ...draft, colors: { ...draft.colors, outsideBg: '#202020' } }
    expect(resolveDraftColors(edited).bg).toBe('#202020')
    expect(deriveReadingTheme(resolveDraftColors(edited)).scrolled)
      .toEqual({ page: deriveReadingTheme(legacy.colors).pageBg, outside: '#202020' })
  })
})

describe('isHexColor', () => {
  it('accepts the editor color-input formats only', () => {
    expect(isHexColor('#abc')).toBe(true)
    expect(isHexColor('#AABBCC')).toBe(true)
    expect(isHexColor('#aabbccdd')).toBe(true)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('#12345')).toBe(false)
    expect(isHexColor('')).toBe(false)
    expect(isHexColor(undefined)).toBe(false)
  })
})

describe('customThemesFromSync', () => {
  it('round-trips valid dual colors', () => {
    const raw = JSON.stringify([{ id: 'c1', name: 'Sea', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: '#101820', outsideBg: '#050505' } }])
    const themes = customThemesFromSync(raw)!
    expect(themes[0].colors.pageBg).toBe('#101820')
    expect(themes[0].colors.outsideBg).toBe('#050505')
  })

  it('drops an invalid dual pair instead of rejecting or half-applying it', () => {
    const raw = JSON.stringify([{ id: 'c1', name: 'Bad', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: 'not-a-color' } }])
    const themes = customThemesFromSync(raw)!
    expect(themes).toHaveLength(1)
    expect(themes[0].colors.pageBg).toBeUndefined()
    expect(themes[0].colors.outsideBg).toBeUndefined()
  })
})

describe('resolveEffectiveReadingTheme', () => {
  const custom = [{ id: 'c1', name: 'Sea', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: '#101820', outsideBg: '#050505' } }]

  it('lets the session override (trial/仅本书) shadow the resolved chain', () => {
    const theme = resolveEffectiveReadingTheme(custom[0], 'paper', custom)
    expect(theme.scrolled).toEqual({ page: '#101820', outside: '#050505' })
  })

  it('falls back to the id chain without an override', () => {
    const theme = resolveEffectiveReadingTheme(null, 'cream', custom)
    expect(theme.scrolled).toBeUndefined()
    expect(theme.bg).toBe('#F4ECE4')
  })
})

describe('phase-2 theme CSS', () => {
  const themed = { id: 't1', name: 'Ink', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, contentCss: 'p { color: red }', uiCss: '[data-bd-ui="header"] { color: blue }' }
  const plain = { id: 't2', name: 'Bare', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' } }

  it('reads old themes without CSS fields as empty CSS', () => {
    expect(themeCssOf(plain)).toEqual({ contentCss: '', uiCss: '', assets: [] })
    expect(themeCssOf(null)).toEqual({ contentCss: '', uiCss: '', assets: [] })
  })

  it('sanitizes synced CSS blocks with the save/preview validators', () => {
    const raw = JSON.stringify([
      themed,
      { ...plain, contentCss: 'body { color: red }', uiCss: '[data-bd-ui="header"] { position: fixed }' },
    ])
    const themes = customThemesFromSync(raw)!
    expect(themes[0].contentCss).toBe('p { color: red }')
    expect(themes[0].uiCss).toBe('[data-bd-ui="header"] { color: blue }')
    expect(themes[1].contentCss).toBe('')
    expect(themes[1].uiCss).toBe('')
  })

  it('follows the effective theme chain and lets the trial draft carry colors and CSS together', () => {
    // follow: the effective theme's CSS
    expect(resolveEffectiveThemeCss(null, themed)).toEqual({ contentCss: 'p { color: red }', uiCss: '[data-bd-ui="header"] { color: blue }', assets: [] })
    expect(resolveEffectiveThemeCss(null, plain)).toEqual({ contentCss: '', uiCss: '', assets: [] })
    // the trial draft wins over the chain
    expect(resolveEffectiveThemeCss(themed, plain)).toEqual({ contentCss: 'p { color: red }', uiCss: '[data-bd-ui="header"] { color: blue }', assets: [] })
  })
})

describe('phase-3 highlight rules', () => {
  const rules = [
    { id: 'r1', name: '对白', pattern: '「[^」]*」', isRegex: true, enabled: true, style: { backgroundColor: '#F5E3B8' } },
    { id: 'r2', name: '书名', pattern: '《(.+?)》', isRegex: true, enabled: true, style: { textColor: '#B8860B' } },
  ]
  const themed = { id: 't1', name: 'Ink', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' }, highlightRules: rules }
  const plain = { id: 't2', name: 'Bare', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' } }

  it('reads old themes without rules as an empty list', () => {
    expect(resolveEffectiveHighlightRules(null, plain)).toEqual([])
    expect(resolveEffectiveHighlightRules(null, null)).toEqual([])
  })

  it('sanitizes synced rules with the same leniency as the other blocks', () => {
    const raw = JSON.stringify([
      themed,
      {
        ...plain,
        highlightRules: [
          { id: '', pattern: 'x' },
          { id: 'ok', name: 'ok', pattern: 'ok', enabled: false, style: { textColor: 'not-a-color' } },
          { id: 'bad-color', name: 'b', pattern: 'y', enabled: true, style: { backgroundColor: '#GGGGGG' } },
        ],
      },
    ])
    const themes = customThemesFromSync(raw)!
    expect(themes[0].highlightRules).toEqual(rules)
    const synced = themes[1].highlightRules!
    expect(synced).toHaveLength(2)
    expect(synced[0]).toMatchObject({ id: 'ok', enabled: false })
    expect(synced[0].style).toBeUndefined()
    expect(synced[1].style).toBeUndefined()
  })

  it('follows the effective theme chain and lets the trial draft carry rules', () => {
    expect(resolveEffectiveHighlightRules(null, themed)).toEqual(rules)
    expect(resolveEffectiveHighlightRules(null, plain)).toEqual([])
    // the trial draft wins over the chain
    const trial = { ...plain, highlightRules: [rules[0]] }
    expect(resolveEffectiveHighlightRules(trial, themed)).toEqual([rules[0]])
  })

  it('keeps the full rule count and drops malformed synced rule payloads', () => {
    const flooded = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: 'x', pattern: 'x', enabled: true }))
    expect(sanitizeHighlightRulesField(flooded)).toHaveLength(100)
    const malformed = [{ id: '', name: 'x', pattern: 'x', enabled: true }, { id: 'ok', name: 'x', pattern: '', enabled: true }]
    expect(sanitizeHighlightRulesField(malformed)).toEqual([])
    expect(sanitizeHighlightRulesField('not-an-array')).toEqual([])
  })

  it('joins legacy themes with their existing rules', () => {
    const draft = legacyThemeToDraft(themed)
    expect(draft.highlightRules).toEqual(rules)
  })
})

describe('phase-4 theme assets', () => {
  it('carries asset fields into the editor draft and combination copies', () => {
    const theme: CustomReadingTheme = {
      id: 't9', name: 'Wallpapered', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' },
      wallpaperAssetId: 'asset-wall', assets: [{ id: 'asset-fig', name: 'f.png' }],
    }
    const draft = legacyThemeToDraft(theme)
    expect(draft.wallpaperAssetId).toBe('asset-wall')
    expect(draft.assets).toEqual([{ id: 'asset-fig', name: 'f.png' }])
    // the CSS block resolution carries the source theme's manifest
    expect(resolveEffectiveThemeCss(null, theme).assets).toEqual([{ id: 'asset-fig', name: 'f.png' }])
    // a theme without assets resolves to an empty manifest
    expect(resolveEffectiveThemeCss(null, { id: 't10', name: 'Bare', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' } }).assets).toEqual([])
  })

  it('sanitizes synced asset fields with the same leniency as the other blocks', () => {
    const raw = JSON.stringify([
      {
        id: 't1', name: 'T1', colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888' },
        wallpaperAssetId: 'asset-ok',
        assets: [{ id: 'asset-good', name: 'a.png' }, { id: 'bad id!', name: 'b.png' }, { id: 'asset-good', name: 'dup.png' }, 'junk'],
      },
      { id: 't2', name: 'T2', colors: { bg: '#222222', fg: '#ffffff', primary: '#999999' }, wallpaperAssetId: 42, assets: 'nope' },
    ])
    const themes = customThemesFromSync(raw)!
    expect(themes[0]!.wallpaperAssetId).toBe('asset-ok')
    expect(themes[0]!.assets).toEqual([{ id: 'asset-good', name: 'a.png' }])
    expect(themes[1]!.wallpaperAssetId).toBeUndefined()
    expect(themes[1]!.assets).toBeUndefined()
  })
})

describe('built-in highlight rule presets', () => {
  function matchedText(kind: HighlightPresetKind, text: string): string[] {
    return computeHighlightSegments(text, [highlightRulePreset(kind)])
      .map(({ start, end }) => text.slice(start, end))
  }

  it('covers all three dialogue quote forms and colors the words without a background', () => {
    // Separated by plain text: adjacent runs with identical styling merge into
    // one segment by design, which would hide which branch matched.
    expect(matchedText('dialogue', '「甲」和『乙』和“丙”')).toEqual(['「甲」', '『乙』', '“丙”'])
    // Dialogue covers most of a page, so it changes the hue only: a filled
    // rectangle would box in an entire scene and fight the dark themes.
    const style = highlightRulePreset('dialogue').style
    expect(style?.textColor).toBe('#A86911')
    expect(style?.backgroundColor).toBeUndefined()
  })

  it('covers full-width, lenticular and half-width brackets', () => {
    expect(matchedText('bracket', '（甲）和【乙】和(丙)')).toEqual(['（甲）', '【乙】', '(丙)'])
  })

  it('dims the enumeration comma together with the rest of the punctuation', () => {
    expect(matchedText('punctuation', '苹果、香蕉，以及梨')).toEqual(['、', '，'])
    // Doubled marks still render as one run rather than two separate dashes.
    expect(matchedText('punctuation', '真的……而且——')).toEqual(['……', '——'])
  })
})
