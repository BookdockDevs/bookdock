import type { HighlightRuleDef } from '@bookdock/shared'
import { compileHighlightRegex, ruleGroupCount } from '@/lib/highlight-match'
import { deriveReadingTheme, isHexColor, type BaseThemeColors, type CustomReadingTheme, type ThemeAssetRef } from '@/lib/reading-theme'

interface ReadingThemeDraft {
  id?: string
  name: string
  colors: BaseThemeColors
  /** Phase-2 book-content CSS; validated at save/trial time */
  contentCss: string
  /** Phase-2 reader-chrome CSS; validated at save/trial time */
  uiCss: string
  /** Phase-3 ordered highlight rules; validated at save/trial time */
  highlightRules: HighlightRuleDef[]
  /** Phase-4 wallpaper asset id, file name, opacity, blur */
  wallpaperAssetId?: string
  wallpaperFileName?: string
  wallpaperOpacity?: number
  wallpaperBlur?: number
  /** Phase-4 CSS-referenced asset manifest */
  assets: ThemeAssetRef[]
  legacyBackground?: boolean
}

export function createHighlightRuleId(): string {
  return `rule-${crypto.getRandomValues(new Uint32Array(3)).join('-')}`
}

/** Per-rule draft validation: located, human-readable, keeps the draft. */
export function highlightRuleIssue(rule: HighlightRuleDef): string | null {
  if (!rule.pattern.trim()) return 'empty'
  if (rule.isRegex && !compileHighlightRegex(rule.pattern)) return 'regex'
  if (rule.isRegex) {
    const count = ruleGroupCount(rule)
    for (const group of rule.groups ?? []) {
      if (group.index > count) return 'group'
    }
  }
  return null
}

// New drafts start from the same visual as the built-in paper theme, with the
// dual pair initialized so the editor always shows four complete colors.
export function defaultThemeDraft(): ReadingThemeDraft {
  return {
    name: '',
    colors: { bg: '#ECECEC', fg: '#1c1917', primary: '#57534e', pageBg: '#ECECEC', outsideBg: '#ECECEC' },
    contentCss: '',
    uiCss: '',
    highlightRules: [],
    assets: [],
  }
}

export function resolveDraftColors({ colors, legacyBackground }: ReadingThemeDraft): BaseThemeColors {
  const { bg, fg, primary, pageBg, outsideBg } = colors
  if (legacyBackground) {
    const legacyPage = deriveReadingTheme({ bg, fg, primary }).pageBg
    if (pageBg === legacyPage && outsideBg === legacyPage) return { bg, fg, primary }
  }
  return { bg: isHexColor(outsideBg) ? outsideBg : bg, fg, primary, pageBg, outsideBg }
}

// An existing legacy theme (bg/fg/primary only) joins the editor with its dual
// pair seeded from the same derived values it renders with today, so saving
// without touching colors keeps its appearance stable.
export function legacyThemeToDraft(theme: CustomReadingTheme): ReadingThemeDraft {
  const rules = theme.highlightRules ?? []
  const assets = (theme.assets ?? []).map((ref) => ({ ...ref }))
  if (isHexColor(theme.colors.pageBg) && isHexColor(theme.colors.outsideBg)) {
    return {
      id: theme.id,
      name: theme.name,
      colors: { ...theme.colors },
      contentCss: theme.contentCss ?? '',
      uiCss: theme.uiCss ?? '',
      highlightRules: rules.map((rule) => ({ ...rule })),
      ...(theme.wallpaperAssetId ? {
        wallpaperAssetId: theme.wallpaperAssetId,
        wallpaperFileName: theme.wallpaperFileName,
        wallpaperOpacity: theme.wallpaperOpacity,
        wallpaperBlur: theme.wallpaperBlur,
      } : {}),
      assets,
    }
  }
  const seeded = deriveReadingTheme(theme.colors).pageBg
  return {
    id: theme.id,
    name: theme.name,
    colors: { ...theme.colors, pageBg: seeded, outsideBg: seeded },
    contentCss: theme.contentCss ?? '',
    uiCss: theme.uiCss ?? '',
    highlightRules: rules.map((rule) => ({ ...rule })),
    ...(theme.wallpaperAssetId ? {
      wallpaperAssetId: theme.wallpaperAssetId,
      wallpaperFileName: theme.wallpaperFileName,
      wallpaperOpacity: theme.wallpaperOpacity,
      wallpaperBlur: theme.wallpaperBlur,
    } : {}),
    assets,
    legacyBackground: true,
  }
}

// Built-in rule presets for the acceptance scenarios; each carries a stable
// id so a per-book disable of a saved preset rule stays bound to it.
//
// Every preset answers one question a reader actually asks while scanning a
// page: who is speaking, what is a title, what is an aside, where the
// punctuation sits. So the defaults split into two families — things the
// reader wants to *find* get a colored text run, things the reader wants to
// *skip* get dimmed. Backgrounds are deliberately not used: a filled rectangle
// is the loudest thing on the page and turns a whole dialogue scene into a
// block of highlighter, which is why the old dialogue preset also collapsed
// into unreadable text on dark themes.
//
// Colors are fixed hex by contract, and one value has to survive both the
// light and the dark theme, so each one sits at the luminance where the worse
// of the two still clears ~3.9:1 — that is the ceiling for a single color that
// must work on white and on near-black.
export type HighlightPresetKind = 'book-title' | 'dialogue' | 'bracket' | 'punctuation'

/**
 * i18n key of the demo line a template seeds into the live preview. It lives
 * here rather than in `highlightRulePreset` because the sample is text, not
 * styling: the editor resolves the key when the template is inserted, so the
 * resulting rule carries a plain string the user can edit afterwards.
 */
export const HIGHLIGHT_PRESET_SAMPLE_KEY: Record<HighlightPresetKind, string> = {
  'dialogue': 'reader.themeHighlightPresetSampleDialogue',
  'book-title': 'reader.themeHighlightPresetSampleBookTitle',
  'bracket': 'reader.themeHighlightPresetSampleBracket',
  'punctuation': 'reader.themeHighlightPresetSamplePunctuation',
}

export function highlightRulePreset(kind: HighlightPresetKind): HighlightRuleDef {
  switch (kind) {
    case 'dialogue':
      return {
        id: createHighlightRuleId(),
        name: '对白',
        // Alternation instead of one `[「『“]…[」』”]` class: each branch closes
        // with its own mark, so a stray 「 can never swallow text up to a ”.
        // 『』 is the inner-quote form, “” the straight-quote form some books
        // use for every line of dialogue.
        pattern: '「[^」]*」|『[^』]*』|“[^”]*”',
        isRegex: true,
        enabled: true,
        // Text color only. Dialogue is the one rule that covers most of a
        // page, so it has to stay a *hue* difference from the body text and
        // never a contrast difference — amber at this luminance reads as
        // speech without dimming the words or boxing them in.
        style: { textColor: '#A86911' },
      }
    case 'book-title':
      return {
        id: createHighlightRuleId(),
        name: '书名号',
        pattern: '《([^《》]+)》',
        isRegex: true,
        enabled: true,
        // Brackets are the container, the title is the content: same rule as
        // the bracket preset below, only split by a capture group. The old
        // gold-first pairing made the 《》 louder than the name inside them and
        // reversed its own contrast on dark themes.
        style: { textColor: '#6B7280' },
        groups: [{ index: 1, style: { textColor: '#3B8282' } }],
      }
    case 'bracket':
      return {
        id: createHighlightRuleId(),
        name: '括号',
        // Full-width （）, the lenticular 【】 that system/stream novels use for
        // alerts, and the half-width pair that translations fall back to.
        pattern: '（[^）]*）|【[^】]*】|\\([^)]*\\)',
        isRegex: true,
        enabled: true,
        // An aside is meant to be skipped at speed, so the whole match dims —
        // but only to the point where it still reads: #9CA3AF only reached
        // 2.54:1 on a white page, which is not "quiet", it is illegible.
        style: { textColor: '#6B7280' },
      }
    case 'punctuation':
      return {
        id: createHighlightRuleId(),
        name: '标点',
        // Includes 、 — without it a list reads as "苹果、香蕉，以及梨" with only
        // the comma dimmed. …— double up in practice; the two adjacent matches
        // merge into one run, so the ellipsis and the dash stay unbroken.
        pattern: '[，、。！？；：…—]',
        isRegex: true,
        enabled: true,
        // Anyone who reaches for this rule is proofreading or hunting for
        // emphatic marks, so it colors instead of fading: a dimmed gray is the
        // opposite of what the rule is switched on for.
        style: { textColor: '#DC2626' },
      }
  }
}
