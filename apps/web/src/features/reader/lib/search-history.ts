export const MAX_SEARCH_HISTORY = 10

const HISTORY_KEY_PREFIX = 'bd-search-history-'

export function historyKey(bookId: string): string {
  return `${HISTORY_KEY_PREFIX}${bookId}`
}

/** Dedupe, prepend, cap — pure so the ordering rules are unit-testable */
export function pushSearchTerm(history: string[], term: string): string[] {
  return [term, ...history.filter((t) => t !== term)].slice(0, MAX_SEARCH_HISTORY)
}

export function loadSearchHistory(bookId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey(bookId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function saveSearchHistory(bookId: string, terms: string[]): void {
  try {
    localStorage.setItem(historyKey(bookId), JSON.stringify(terms))
  } catch { /* private-mode quota failures are non-fatal */ }
}

export function clearSearchHistory(bookId: string): void {
  try {
    localStorage.removeItem(historyKey(bookId))
  } catch { /* noop */ }
}
