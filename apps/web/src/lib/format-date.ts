// Date and time formatting for display.
//
// The locale is pinned to the app's active language rather than left to the
// browser: a bare `toLocaleDateString()` follows the browser's language, so the
// same row read `11/14/2023` in an English browser and `2023/11/15` in a Chinese
// one, and nothing in the app agreed on which to show.
//
// The timezone stays local on purpose — a timestamp is shown in the reader's own
// timezone, so "when did I join" means when it was for them.
//
// Import the raw i18next instance, not `@/i18n/i18n`: the latter initializes the
// app's resources as an import side effect, so a module that only needs the
// active language would drag real translations into test trees that mock
// `useTranslation` to return raw keys.
import i18n from 'i18next'

/** Read per call, not at import, so a language switch takes effect immediately. */
function activeLocale(): string {
  return i18n.language || 'zh-CN'
}

function toDate(timestamp: number | string | Date): Date {
  return timestamp instanceof Date ? timestamp : new Date(timestamp)
}

/** Date only, e.g. `2023/11/15` or `11/14/2023`. */
export function formatDate(timestamp: number | string | Date): string {
  return toDate(timestamp).toLocaleDateString(activeLocale())
}

/** Time only, 24-hour, e.g. `21:30`. */
export function formatTime(timestamp: number | string | Date): string {
  return toDate(timestamp).toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Date and time, e.g. `2023/11/15 21:30`. */
export function formatDateTime(timestamp: number | string | Date): string {
  return toDate(timestamp).toLocaleString(activeLocale())
}

/** Short month name for axis labels, e.g. `11月` or `Nov`. */
export function formatMonthShort(date: Date): string {
  return date.toLocaleDateString(activeLocale(), { month: 'short' })
}
