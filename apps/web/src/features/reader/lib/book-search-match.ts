import type { SearchMatch } from './book-search'

export interface SearchMatchOptions {
  mode?: 'contains' | 'regex'
  matchCase?: boolean
  limit?: number
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findMatches(text: string, query: string, opts?: SearchMatchOptions): SearchMatch[] {
  if (!text || !query) return []
  const matches: SearchMatch[] = []
  const limit = opts?.limit ?? Infinity
  if (limit <= 0) return matches
  if (opts?.mode === 'regex') {
    let re: RegExp
    try {
      re = new RegExp(query, opts?.matchCase ? 'gu' : 'giu')
    } catch {
      // invalid pattern: no results, don't crash the whole search
      return []
    }
    for (const m of text.matchAll(re)) {
      // skip empty matches so `.*`-style patterns can't flood the result list
      if (!m[0]) continue
      matches.push({ start: m.index, end: m.index + m[0].length })
      if (matches.length >= limit) break
    }
    return matches
  }
  const normalizedQuery = query.replace(/\s+/g, ' ').trim()
  if (!normalizedQuery) return []
  const haystack = opts?.matchCase ? text : text.toLowerCase()
  const needle = opts?.matchCase ? normalizedQuery : normalizedQuery.toLowerCase()

  let index = -1
  while ((index = haystack.indexOf(needle, index + 1)) > -1) {
    matches.push({ start: index, end: index + needle.length })
    if (matches.length >= limit) break
  }

  // If exact substring didn't match and the query contains whitespace,
  // allow flexible whitespace matching (e.g. matching across \n or multiple spaces in text)
  if (matches.length === 0 && /\s/.test(normalizedQuery)) {
    const pattern = escapeRegex(normalizedQuery).replace(/ /g, '\\s+')
    try {
      const re = new RegExp(pattern, opts?.matchCase ? 'gu' : 'giu')
      for (const m of text.matchAll(re)) {
        if (!m[0]) continue
        matches.push({ start: m.index, end: m.index + m[0].length })
        if (matches.length >= limit) break
      }
    } catch {
      // fallback safety
    }
  }

  return matches
}

