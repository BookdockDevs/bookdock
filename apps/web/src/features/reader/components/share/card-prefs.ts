import type { FontFamily } from '../../types'

export type ShareCardTemplate = 'classic' | 'calendar' | 'ink' | 'letter' | 'brocade'
export type ShareCardBackground = 'cream' | 'white' | 'pink' | 'green' | 'blue' | 'black' | 'navy' | 'slate'

export const SHARE_CARD_TEMPLATES: ShareCardTemplate[] = ['classic', 'calendar', 'ink', 'letter', 'brocade']

export interface CardColors {
  bg: string
  /** Body text */
  text: string
  /** Attribution / quote / identity secondary text */
  sub: string
  /** Decorations: ink bars, letter frame, calendar divider, quote glyph */
  accent: string
  watermark: string
}

export interface BackgroundOption {
  id: ShareCardBackground
  colors: CardColors
}

const LIGHT_TEXT = { text: '#1c1917', sub: '#57534e', accent: '#44403c', watermark: '#8c857e' }
const DARK_TEXT = { text: '#f5f5f4', sub: '#d6d3d1', accent: '#e7e5e4', watermark: '#8c857e' }

export const BACKGROUND_OPTIONS: BackgroundOption[] = [
  { id: 'white', colors: { bg: '#ffffff', ...LIGHT_TEXT } },
  { id: 'cream', colors: { bg: '#f9f6f0', ...LIGHT_TEXT } },
  { id: 'pink', colors: { bg: '#fbf3ef', ...LIGHT_TEXT } },
  { id: 'green', colors: { bg: '#f1f6ef', ...LIGHT_TEXT } },
  { id: 'blue', colors: { bg: '#eef4fa', ...LIGHT_TEXT } },
  { id: 'black', colors: { bg: '#1c1917', ...DARK_TEXT } },
  { id: 'navy', colors: { bg: '#1f2a52', ...DARK_TEXT } },
  { id: 'slate', colors: { bg: '#586c8a', text: '#f8fafc', sub: '#e2e8f0', accent: '#e2e8f0', watermark: '#aebdd4' } },
]

export function cardColors(id: ShareCardBackground): CardColors {
  return (BACKGROUND_OPTIONS.find((b) => b.id === id) ?? BACKGROUND_OPTIONS[1]).colors
}

export interface ShareCardPrefs {
  template: ShareCardTemplate
  font: FontFamily
  background: ShareCardBackground
  /** Footer brand zone: hidden / "Bookdock" / "书坞". QR codes are a documented
   *  future seam (book sharing), decided against for now */
  brand: ShareCardBrand
}

export type ShareCardBrand = 'off' | 'en' | 'zh'

export const BRAND_OPTIONS: ShareCardBrand[] = ['en', 'zh', 'off']
const BRAND_CYCLE: ShareCardBrand[] = ['off', 'en', 'zh']

export function nextBrand(brand: ShareCardBrand): ShareCardBrand {
  return BRAND_CYCLE[(BRAND_CYCLE.indexOf(brand) + 1) % BRAND_CYCLE.length]
}

export const DEFAULT_SHARE_CARD_PREFS: ShareCardPrefs = {
  template: 'classic',
  font: 'serif',
  background: 'cream',
  brand: 'en',
}

const STORAGE_KEY = 'bd-share-card-prefs'
const BACKGROUND_IDS = BACKGROUND_OPTIONS.map((b) => b.id)

/** Card-appearance prefs live only in localStorage: export cosmetics have no
 *  cross-device sync value and stay decoupled from the reading theme */
export function loadShareCardPrefs(): ShareCardPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SHARE_CARD_PREFS
    const parsed = JSON.parse(raw) as Partial<ShareCardPrefs>
    return {
      template: SHARE_CARD_TEMPLATES.includes(parsed.template as ShareCardTemplate)
        ? (parsed.template as ShareCardTemplate)
        : DEFAULT_SHARE_CARD_PREFS.template,
      // Any non-empty id is accepted: builtin/uploaded registry ids resolve at
      // render time and unknown ids fall back to the default stack there
      font: typeof parsed.font === 'string' && parsed.font !== ''
        ? parsed.font
        : DEFAULT_SHARE_CARD_PREFS.font,
      background: BACKGROUND_IDS.includes(parsed.background as ShareCardBackground)
        ? (parsed.background as ShareCardBackground)
        : DEFAULT_SHARE_CARD_PREFS.background,
      brand: BRAND_CYCLE.includes(parsed.brand as ShareCardBrand)
        ? (parsed.brand as ShareCardBrand)
        : DEFAULT_SHARE_CARD_PREFS.brand,
    }
  } catch {
    return DEFAULT_SHARE_CARD_PREFS
  }
}

export function saveShareCardPrefs(prefs: ShareCardPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private-mode quota failures are non-fatal: the dialog keeps working
  }
}
