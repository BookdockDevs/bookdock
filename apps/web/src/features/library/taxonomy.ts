import type { Category, LibrarySortPreference } from '@bookdock/shared'

import { sortSidebarItems } from './sort-modes'

export function categoryPath(categories: Category[], id: string): Category[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const path: Category[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

export function sortCategories(categories: Category[], pref: LibrarySortPreference | undefined): Category[] {
  const children = new Map<string | null, Category[]>()
  const ids = new Set(categories.map((category) => category.id))
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null
    const group = children.get(parent) ?? []
    group.push(category)
    children.set(parent, group)
  }
  const ordered: Category[] = []
  const seen = new Set<string>()
  const visit = (parentId: string | null) => {
    const group = children.get(parentId) ?? []
    const sorted = parentId === null && pref?.mode === 'bookCount'
      ? sortSidebarItems(group.map((category) => ({ ...category, bookCount: category.subtreeBookCount })), pref).map((category) => group.find((original) => original.id === category.id)!)
      : sortSidebarItems(group, pref)
    for (const category of sorted) {
      if (seen.has(category.id)) continue
      seen.add(category.id)
      ordered.push(category)
      visit(category.id)
    }
  }
  visit(null)
  // Historical malformed nodes stay reachable for managers rather than disappearing.
  for (const category of categories) if (!seen.has(category.id)) ordered.push(category)
  return ordered
}

export function categoryChoices(categories: Category[]) {
  return sortCategories(categories, { mode: 'manual' }).map((category) => ({
    ...category,
    name: categoryPath(categories, category.id).map((node) => node.name).join(' / '),
  }))
}
