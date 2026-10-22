import { bindLibrarySearch, normalizeLibrarySearch, parseLibrarySearch, printLibrarySearch, readLibrarySearchExpression, simpleLibrarySearch, visitLibrarySearch, type LibrarySearchExpression, type LibrarySearchField, type LibrarySearchNames } from '@bookdock/shared'

import type { LibrarySearch } from '@/routes/index'

/** Taxonomy, trash, and directory navigation returns the shared library to its book list. */
export function clearActivityForLibraryNavigation(patch: Partial<LibrarySearch>): Partial<LibrarySearch> {
  if (patch.section === 'activity') return patch
  const clearKeys = ['shelf', 'category', 'tag', 'directory', 'trash'] as const
  if (clearKeys.some((key) => key in patch && patch[key] !== undefined)) {
    return { ...patch, section: undefined, activityType: undefined }
  }
  return patch
}

/** Leaving or switching a library clears view state scoped to its activity feed. */
export function clearActivityForLibrarySwitch(patch: Partial<LibrarySearch>): Partial<LibrarySearch> {
  return { ...patch, section: undefined, activityType: undefined }
}

export interface LibrarySearchReturn {
  search: LibrarySearch
  scrollTop: number
  back?: boolean
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    librarySearchReturn?: LibrarySearchReturn
  }
}

export function submittedSearchPatch(source: string, names: LibrarySearchNames): Partial<LibrarySearch> {
  const parsed = parseLibrarySearch(source)
  const patch: Partial<LibrarySearch> = { expression: undefined, q: undefined, page: undefined }
  if (!parsed) return patch
  if (parsed.kind === 'text' && !/[&|!()":\\]/.test(parsed.value)) {
    patch.q = parsed.value
    return patch
  }
  patch.expression = JSON.stringify(bindLibrarySearch(parsed, names))
  visitLibrarySearch(parsed, (node) => {
    if (node.kind === 'field') Object.assign(patch, { [node.field === 'category' ? 'category' : node.field]: undefined })
  })
  return patch
}

export function searchExitTarget(search: LibrarySearch, saved?: LibrarySearchReturn): LibrarySearch {
  if (saved && saved.search.libraryId === search.libraryId && saved.search.trash === search.trash) return saved.search
  return { ...search, expression: undefined, q: undefined, page: undefined }
}

export function searchSessionNavigation(search: LibrarySearch, patch: Partial<LibrarySearch>, saved?: LibrarySearchReturn, scrollTop = 0) {
  const linkedSearch = !!(search.q || search.expression)
  const snapshot = saved ?? { search: linkedSearch ? searchExitTarget(search) : search, scrollTop, back: !linkedSearch }
  return { search: { ...search, ...patch }, state: { librarySearchReturn: snapshot }, replace: !!saved, resetScroll: false }
}

export function keepsSearchSession(patch: Partial<LibrarySearch>): boolean {
  return Object.keys(patch).every((key) => ['page', 'view', 'sortBy', 'sortOrder'].includes(key))
}

/**
 * Adopt a pending archive-exit scroll request exactly once per history
 * entry. Returns the restore snapshot for the existing gated scroll effect,
 * or null when there is nothing to adopt (or this entry already adopted).
 */
export function adoptArchiveExitRestore(
  adoptedKey: string | undefined,
  entryKey: string | undefined,
  want: number | undefined,
  search: LibrarySearch,
): { key: string; restore: { search: LibrarySearch; top: number } } | null {
  if (want == null || entryKey === undefined || adoptedKey === entryKey) return null
  return { key: entryKey, restore: { search, top: want } }
}

const controlFields: Partial<Record<keyof LibrarySearch, LibrarySearchField | 'text'>> = {
  shelf: 'shelf', category: 'category', tag: 'tag', author: 'author', format: 'format', status: 'status', q: 'text',
}

export function searchProjection(expression?: string): Partial<LibrarySearch> {
  if (!expression) return {}
  try {
    const nodes = simpleLibrarySearch(readLibrarySearchExpression(expression))
    if (!nodes) return {}
    const result: Partial<LibrarySearch> = {}
    for (const [key, field] of Object.entries(controlFields)) {
      if (key === 'q') continue
      const matches = nodes.filter((node) => node.kind === 'field' && node.field === field)
      if (matches.length === 1) {
        const node = matches[0] as Extract<LibrarySearchExpression, { kind: 'field' }>
        Object.assign(result, { [key]: node.id ?? node.value })
      }
    }
    return result
  } catch { return {} }
}

export function editSearchControls(search: LibrarySearch, patch: Partial<LibrarySearch>): Partial<LibrarySearch> {
  if (!search.expression || 'expression' in patch) return patch
  let root: LibrarySearchExpression
  try { root = readLibrarySearchExpression(search.expression) } catch { return patch }
  if (!simpleLibrarySearch(root)) return patch
  const fields = Object.entries(controlFields).filter(([key]) => key in patch).map(([, field]) => field)
  if (!fields.length) return patch
  const remove = (node: LibrarySearchExpression): LibrarySearchExpression | undefined => {
    if (node.kind === 'text') return fields.includes('text') ? undefined : node
    if (node.kind === 'field') return fields.includes(node.field) ? undefined : node
    if (node.kind !== 'and') return node
    const left = remove(node.left)
    const right = remove(node.right)
    return left && right ? { ...node, left, right } : left ?? right
  }
  const next = remove(root)
  return { ...patch, expression: next ? JSON.stringify(normalizeLibrarySearch(next)) : undefined }
}

export function expressionDisplay(expression?: string, fallback = ''): string {
  if (!expression) return fallback
  try { return printLibrarySearch(readLibrarySearchExpression(expression)) } catch { return expression }
}

export function removeSearchCondition(expression: string, index: number): string | undefined {
  const root = readLibrarySearchExpression(expression)
  if (!simpleLibrarySearch(root)) return expression
  let current = 0
  const remove = (node: LibrarySearchExpression): LibrarySearchExpression | undefined => {
    if (node.kind !== 'and') return current++ === index ? undefined : node
    const left = remove(node.left)
    const right = remove(node.right)
    return left && right ? { ...node, left, right } : left ?? right
  }
  const next = remove(root)
  return next ? JSON.stringify(normalizeLibrarySearch(next)) : undefined
}
