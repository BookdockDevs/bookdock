export const EXCERPT_MAX_CHARS = 600
export const NOTE_MAX_CHARS = 600
/** The quoted excerpt on an idea card is context, not the subject — capped tighter */
export const QUOTE_MAX_CHARS = 200

export interface ExcerptTypography {
  fontSize: number
  lineHeight: number
  letterSpacing?: string
}

const TYPO_TIERS = [
  { max: 60, size: 28, lineHeight: 1.65, letterSpacing: '0.025em' },
  { max: 160, size: 23, lineHeight: 1.75, letterSpacing: '0.01em' },
  { max: 320, size: 19, lineHeight: 1.8, letterSpacing: 'normal' },
] as const

export const EXCERPT_MIN_FONT_SIZE = 16

/** Adaptive excerpt typography: adjusts font size, line height and letter spacing by length */
export function excerptTypography(length: number): ExcerptTypography {
  for (const tier of TYPO_TIERS) {
    if (length <= tier.max) {
      return { fontSize: tier.size, lineHeight: tier.lineHeight, letterSpacing: tier.letterSpacing }
    }
  }
  return { fontSize: EXCERPT_MIN_FONT_SIZE, lineHeight: 1.85, letterSpacing: 'normal' }
}

/** Adaptive excerpt font size: longer text renders smaller, down to a floor */
export function excerptFontSize(length: number): number {
  return excerptTypography(length).fontSize
}

/** Hard cap for the card body; truncation is display-only, the annotation keeps full text */
export function truncateExcerpt(text: string, max = EXCERPT_MAX_CHARS): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, max).join('')}……`
}

/** Split raw excerpt text into display paragraphs: blank-line runs become
 * paragraph breaks, so card spacing is CSS-controlled instead of depending on
 * the book's own blank lines (which whitespace-pre-wrap would double-render) */
export function excerptParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** `书名 · 章节名`, degrading to `书名` when the chapter is unknown */
export function attributionLine(title: string, chapter: string | null): string {
  return chapter ? `${title} · ${chapter}` : title
}

/** `书摘-书名-YYYYMMDD.png` with filesystem-hostile characters stripped */
export function shareFileName(title: string, date = new Date()): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'book'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `书摘-${safe}-${y}${m}${d}.png`
}

/** `2024/5/30` — unpadded, matching the idea-card "写于" convention */
export function formatShareDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

const MONTH_NAMES_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
const WEEKDAY_NAMES_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** Calendar-template date block: big day, EN month-year, ZH weekday (screenshot convention) */
export function calendarDateParts(date = new Date()): { day: string; monthYear: string; weekday: string } {
  return {
    day: String(date.getDate()),
    monthYear: `${MONTH_NAMES_EN[date.getMonth()]} ${date.getFullYear()}`,
    weekday: WEEKDAY_NAMES_ZH[date.getDay()],
  }
}

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1-31 → 一…三十一 (calendar numerals for month/day) */
export function toChineseNumeral(n: number): string {
  if (n < 10) return CN_DIGITS[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  const tensPart = tens === 1 ? '十' : `${CN_DIGITS[tens]}十`
  return ones === 0 ? tensPart : `${tensPart}${CN_DIGITS[ones]}`
}

/** `二〇二四年五月三十日` — ink-template idea date (screenshot convention) */
export function formatChineseDate(ts: number): string {
  const d = new Date(ts)
  const year = [...String(d.getFullYear())].map((c) => CN_DIGITS[Number(c)]).join('')
  return `${year}年${toChineseNumeral(d.getMonth() + 1)}月${toChineseNumeral(d.getDate())}日`
}
