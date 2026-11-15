import { and, eq, isNull, sql } from 'drizzle-orm'

import {
  classificationValueKey,
  normalizeCategoryPath,
  normalizeTagNames,
  parseCategoryValueKey,
  type Category,
  type LibraryTag,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraryBooks, libraryBookTagValues, libraryMetadataValueState, libraries } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { assertLibraryBrowsable, isLibraryManager, requireLibraryManager } from '../libraries/library-access'
import {
  hiddenCategoryExclusion,
  hiddenShelfExclusion,
  hiddenTagExclusion,
  loadLibraryHiddenTaxonomy,
  publishedWorkExists,
  workDirectHiddenExclusion,
} from '../libraries/library-query'
import type { SQL } from 'drizzle-orm'

/**
 * Category and tag *values* for one library.
 *
 * Nothing here creates or deletes a taxonomy entity: the candidates a sidebar
 * shows are aggregated from what the books carry, and the only rows this module
 * owns are the preference rows in `library_metadata_value_state` (hidden,
 * pinned, manual order). Renaming and clearing are bulk book-metadata
 * operations, so they reach hidden and trashed entries too — a value the trash
 * still holds is not "unused".
 */

type Db = ReturnType<typeof getDb>
/** A transaction exposes the same query builders this module needs. */
type Reader = Pick<Db, 'select' | 'insert' | 'update'>

interface ValueStateRow {
  id: string
  value: string
  sortOrder: number
  pinned: boolean
  hidden: boolean
  createdAt: number
  updatedAt: number
}

function getLibraryRow(db: Db, libraryId: string) {
  const row = db.select({ id: libraries.id, type: libraries.type }).from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!row) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  return row
}

function loadValueState(db: Db, libraryId: string, kind: 'category' | 'tag'): Map<string, ValueStateRow> {
  const rows = db.select({
    id: libraryMetadataValueState.id,
    value: libraryMetadataValueState.value,
    sortOrder: libraryMetadataValueState.sortOrder,
    pinned: libraryMetadataValueState.pinned,
    hidden: libraryMetadataValueState.hidden,
    createdAt: libraryMetadataValueState.createdAt,
    updatedAt: libraryMetadataValueState.updatedAt,
  }).from(libraryMetadataValueState)
    .where(and(eq(libraryMetadataValueState.libraryId, libraryId), eq(libraryMetadataValueState.kind, kind))).all()
  return new Map(rows.map((row) => [row.value, row]))
}

/** Default sort placement for a value nobody has ordered yet: last, by name. */
const UNSORTED = Number.MAX_SAFE_INTEGER

function compareNodes(left: { sortOrder: number; name: string }, right: { sortOrder: number; name: string }): number {
  return left.sortOrder - right.sortOrder || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

/**
 * The visibility predicates every sidebar count shares with the list it
 * annotates: direct hide, shelf/category/tag hides, and — for a shared library
 * seen by a non-manager — published works only.
 */
function countConditions(manager: boolean, showHidden: boolean, libraryId: string, libraryType: 'private' | 'shared'): SQL[] {
  const conditions: SQL[] = []
  if (!manager && libraryType === 'shared') conditions.push(publishedWorkExists())
  if (showHidden) return conditions
  const taxonomy = loadLibraryHiddenTaxonomy(getDb(), libraryId)
  conditions.push(workDirectHiddenExclusion())
  const shelf = hiddenShelfExclusion(taxonomy.hiddenShelfIds)
  if (shelf) conditions.push(shelf)
  const category = hiddenCategoryExclusion(taxonomy.hiddenCategoryPaths)
  if (category) conditions.push(category)
  const tag = hiddenTagExclusion(taxonomy.hiddenTagNames)
  if (tag) conditions.push(tag)
  return conditions
}

/** Sidebar category tree, aggregated from the paths books carry. */
export async function listCategoryValues(actorId: string, libraryId: string, options: { showHidden?: boolean } = {}): Promise<Category[]> {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const library = getLibraryRow(db, libraryId)
  const manager = await isLibraryManager(actorId, libraryId)
  // A private owner sees hidden values only when the reveal switch is on; a
  // shared manager always sees them, because hiding is a rule they curate.
  const showHidden = manager && (Boolean(options.showHidden) || library.type === 'shared')
  const conditions = countConditions(manager, showHidden, libraryId, library.type)
  const rows = db.select({
    root: libraryBooks.categoryRoot,
    leaf: libraryBooks.categoryLeaf,
    count: sql<number>`count(*)`,
  }).from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, libraryId), isNull(libraryBooks.deletedAt), ...conditions))
    .groupBy(libraryBooks.categoryRoot, libraryBooks.categoryLeaf).all()

  const state = loadValueState(db, libraryId, 'category')
  const direct = new Map<string, number>()
  const children = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (!row.root) continue
    if (!row.leaf) {
      direct.set(row.root, (direct.get(row.root) ?? 0) + row.count)
      if (!children.has(row.root)) children.set(row.root, new Map())
      continue
    }
    const bucket = children.get(row.root) ?? new Map<string, number>()
    bucket.set(row.leaf, (bucket.get(row.leaf) ?? 0) + row.count)
    children.set(row.root, bucket)
  }

  const nodes: Category[] = []
  const build = (path: string[], bookCount: number, subtreeBookCount: number): Category => {
    const key = classificationValueKey('category', path)
    const pref = state.get(key)
    return {
      id: key,
      path,
      name: path[path.length - 1]!,
      parentId: path.length === 1 ? null : classificationValueKey('category', path.slice(0, -1)),
      sortOrder: pref?.sortOrder ?? UNSORTED,
      pinned: pref?.pinned ?? false,
      hidden: pref?.hidden ?? false,
      createdAt: pref?.createdAt ?? 0,
      updatedAt: pref?.updatedAt ?? 0,
      bookCount,
      subtreeBookCount,
    }
  }

  for (const [root, leafCounts] of children) {
    const rootPref = state.get(classificationValueKey('category', [root]))
    if (!showHidden && rootPref?.hidden) continue
    const rootDirect = direct.get(root) ?? 0
    let subtree = rootDirect
    const leafNodes: Category[] = []
    for (const [leaf, count] of leafCounts) {
      const path = [root, leaf]
      if (!showHidden && state.get(classificationValueKey('category', path))?.hidden) continue
      subtree += count
      leafNodes.push(build(path, count, count))
    }
    nodes.push(build([root], rootDirect, subtree))
    nodes.push(...leafNodes)
  }
  return nodes.sort(compareNodes)
}

/** Sidebar tag list, aggregated from the values books carry. */
export async function listTagValues(actorId: string, libraryId: string, options: { showHidden?: boolean } = {}): Promise<LibraryTag[]> {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const library = getLibraryRow(db, libraryId)
  const manager = await isLibraryManager(actorId, libraryId)
  const showHidden = manager && (Boolean(options.showHidden) || library.type === 'shared')
  const conditions = countConditions(manager, showHidden, libraryId, library.type)
  const rows = db.select({
    name: libraryBookTagValues.name,
    count: sql<number>`count(*)`,
  })
    .from(libraryBookTagValues)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookTagValues.libraryBookId))
    .where(and(eq(libraryBooks.libraryId, libraryId), isNull(libraryBooks.deletedAt), ...conditions))
    .groupBy(libraryBookTagValues.name).all()

  const state = loadValueState(db, libraryId, 'tag')
  const tags: LibraryTag[] = []
  for (const row of rows) {
    const pref = state.get(row.name)
    if (!showHidden && pref?.hidden) continue
    tags.push({
      id: row.name,
      name: row.name,
      sortOrder: pref?.sortOrder ?? UNSORTED,
      pinned: pref?.pinned ?? false,
      hidden: pref?.hidden ?? false,
      createdAt: pref?.createdAt ?? 0,
      updatedAt: pref?.updatedAt ?? 0,
      bookCount: row.count,
    })
  }
  return tags.sort(compareNodes)
}

function nextSortOrder(db: Reader, libraryId: string, kind: 'category' | 'tag'): number {
  const row = db.select({ max: sql<number | null>`max(${libraryMetadataValueState.sortOrder})` })
    .from(libraryMetadataValueState)
    .where(and(eq(libraryMetadataValueState.libraryId, libraryId), eq(libraryMetadataValueState.kind, kind))).get()
  return (row?.max ?? -1) + 1
}

/** Write a preference row, creating it on first use with neutral defaults. */
function writeState(
  db: Reader,
  libraryId: string,
  kind: 'category' | 'tag',
  value: string,
  patch: { pinned?: boolean; hidden?: boolean; sortOrder?: number; createdAt?: number },
) {
  const now = Date.now()
  const existing = db.select({ id: libraryMetadataValueState.id }).from(libraryMetadataValueState)
    .where(and(
      eq(libraryMetadataValueState.libraryId, libraryId),
      eq(libraryMetadataValueState.kind, kind),
      eq(libraryMetadataValueState.value, value),
    )).get()
  if (existing) {
    const update: Partial<typeof libraryMetadataValueState.$inferInsert> = {}
    if (patch.pinned !== undefined) update.pinned = patch.pinned
    if (patch.hidden !== undefined) update.hidden = patch.hidden
    if (patch.sortOrder !== undefined) update.sortOrder = patch.sortOrder
    if (patch.pinned !== undefined || patch.hidden !== undefined) update.updatedAt = now
    if (Object.keys(update).length > 0) db.update(libraryMetadataValueState).set(update).where(eq(libraryMetadataValueState.id, existing.id)).run()
    return
  }
  db.insert(libraryMetadataValueState).values({
    id: createId('mvs'),
    libraryId,
    kind,
    value,
    sortOrder: patch.sortOrder ?? nextSortOrder(db, libraryId, kind),
    pinned: patch.pinned ?? false,
    hidden: patch.hidden ?? false,
    createdAt: patch.createdAt ?? now,
    updatedAt: now,
  }).run()
}

/** Every category path this library's books carry, hidden and trashed included. */
function usedCategoryPaths(db: Db, libraryId: string): string[][] {
  const rows = db.selectDistinct({ root: libraryBooks.categoryRoot, leaf: libraryBooks.categoryLeaf })
    .from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, libraryId), sql`${libraryBooks.categoryRoot} IS NOT NULL`)).all()
  return rows.flatMap((row) => {
    if (!row.root) return []
    return [row.leaf ? [row.root, row.leaf] : [row.root]]
  })
}

function usedTagNames(db: Db, libraryId: string): string[] {
  return db.selectDistinct({ name: libraryBookTagValues.name }).from(libraryBookTagValues)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookTagValues.libraryBookId))
    .where(eq(libraryBooks.libraryId, libraryId)).all().map((row) => row.name)
}

function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.every((name, index) => path[index] === name)
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

export interface CategoryValuePatch {
  path: string[]
  /** New name for this node's own last segment. */
  name?: string
  /** New parent path; null promotes the node to a root. Absent leaves it. */
  parentPath?: string[] | null
  pinned?: boolean
  hidden?: boolean
}

/**
 * Rename, re-parent, hide or pin one category value.
 *
 * A rename or move rewrites the value on every book carrying the path — the
 * whole branch when a root moves — and carries the preference rows along, so
 * hiding and manual order survive. Anything that cannot be applied without
 * guessing (the target already carrying books, or two preference rows needing
 * a merge) is refused instead of merged.
 */
export async function updateCategoryValue(actorId: string, libraryId: string, patch: CategoryValuePatch): Promise<Category[]> {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const path = normalizeCategoryPath(patch.path)
  if (!path) throw new AppError('VALIDATION_ERROR', 'A category path needs one or two names')

  const targetPath = resolveTargetPath(path, patch)
  if (!samePath(path, targetPath)) renameCategoryBranch(db, libraryId, path, targetPath)

  if (patch.pinned !== undefined || patch.hidden !== undefined) {
    writeState(db, libraryId, 'category', classificationValueKey('category', targetPath), {
      ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
      ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
    })
  }
  return listCategoryValues(actorId, libraryId)
}

function resolveTargetPath(path: string[], patch: CategoryValuePatch): string[] {
  const ownName = (patch.name ?? path[path.length - 1]!).trim()
  if (!ownName) throw new AppError('VALIDATION_ERROR', 'A category name cannot be empty')
  if (patch.parentPath === undefined) return [...path.slice(0, -1), ownName]
  const parent = normalizeCategoryPath(patch.parentPath)
  if (patch.parentPath !== null && !parent) throw new AppError('VALIDATION_ERROR', 'Invalid category parent')
  return parent ? [parent[0]!, ownName] : [ownName]
}

/**
 * Rewrite one path (or a root's whole branch) to a new path, moving preference
 * rows with it. Runs inside the caller's transaction.
 */
function renameCategoryBranch(db: Db, libraryId: string, from: string[], to: string[]) {
  const state = loadValueState(db, libraryId, 'category')
  const paths = new Set<string>([...usedCategoryPaths(db, libraryId).map((path) => JSON.stringify(path)), ...state.keys()])
  const moved = [...paths].map((key) => parseCategoryValueKey(key)).filter((path): path is string[] => path !== null)
    .filter((path) => startsWith(path, from))
  if (moved.length === 0) return

  const targets = new Map<string, string[]>()
  for (const path of moved) targets.set(JSON.stringify(path), [...to, ...path.slice(from.length)])
  if ([...targets.values()].some((path) => path.length > 2)) {
    throw new AppError('VALIDATION_ERROR', 'Category paths cannot exceed two levels')
  }
  const movedKeys = new Set([...targets.keys()])
  for (const [key, target] of targets) {
    const targetKey = JSON.stringify(target)
    if (movedKeys.has(targetKey)) continue
    const targetInUse = paths.has(targetKey)
    const prefConflict = state.has(key) && state.has(targetKey)
    if (targetInUse || prefConflict) {
      throw new AppError('CLASSIFICATION_CONFLICT', `Category "${target.join(' / ')}" already exists`)
    }
  }

  const now = Date.now()
  db.transaction((tx) => {
    for (const [key, target] of targets) {
      tx.update(libraryMetadataValueState).set({ value: JSON.stringify(target), updatedAt: now })
        .where(and(
          eq(libraryMetadataValueState.libraryId, libraryId),
          eq(libraryMetadataValueState.kind, 'category'),
          eq(libraryMetadataValueState.value, key),
        )).run()
    }
    for (const [key, target] of targets) {
      const [root, leaf] = target
      const [oldRoot, oldLeaf] = JSON.parse(key) as string[]
      tx.update(libraryBooks).set({
        categoryRoot: root ?? null,
        categoryLeaf: leaf ?? null,
        updatedAt: now,
      }).where(and(
        eq(libraryBooks.libraryId, libraryId),
        eq(libraryBooks.categoryRoot, oldRoot!),
        oldLeaf === undefined ? isNull(libraryBooks.categoryLeaf) : eq(libraryBooks.categoryLeaf, oldLeaf),
      )).run()
    }
  })
}

/** Persist a manual order for the values the sidebar currently lists. */
export async function reorderCategoryValues(actorId: string, libraryId: string, keys: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const nodes = await listCategoryValues(actorId, libraryId, { showHidden: true })
  const known = new Set(nodes.map((node) => node.id))
  if (new Set(keys).size !== keys.length || keys.some((key) => !known.has(key))) {
    throw new AppError('CLASSIFICATION_NOT_FOUND', 'Unknown category value')
  }
  db.transaction((tx) => {
    for (const [index, key] of keys.entries()) writeState(tx, libraryId, 'category', key, { sortOrder: index })
  })
}

/** Clear a category path from every book; a root clears its whole branch. */
export async function clearCategoryValue(actorId: string, libraryId: string, rawPath: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const path = normalizeCategoryPath(rawPath)
  if (!path) throw new AppError('VALIDATION_ERROR', 'A category path needs one or two names')
  const now = Date.now()
  const conditions = [eq(libraryBooks.libraryId, libraryId), eq(libraryBooks.categoryRoot, path[0]!)]
  if (path.length === 2) conditions.push(eq(libraryBooks.categoryLeaf, path[1]!))
  db.update(libraryBooks).set({ categoryRoot: null, categoryLeaf: null, updatedAt: now })
    .where(and(...conditions)).run()
  // Preference rows stay: the value may return later and should keep its place.
  return listCategoryValues(actorId, libraryId)
}

export interface TagValuePatch {
  name: string
  /** New name for the value; rewrites every book carrying it. */
  renamedTo?: string
  pinned?: boolean
  hidden?: boolean
}

export async function updateTagValue(actorId: string, libraryId: string, patch: TagValuePatch): Promise<LibraryTag[]> {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const name = patch.name.trim()
  if (!name) throw new AppError('VALIDATION_ERROR', 'A tag name cannot be empty')
  const renamedTo = patch.renamedTo === undefined ? undefined : normalizeTagNames([patch.renamedTo])[0]
  if (patch.renamedTo !== undefined && !renamedTo) throw new AppError('VALIDATION_ERROR', 'A tag name cannot be empty')

  if (renamedTo && renamedTo !== name) {
    const used = new Set(usedTagNames(db, libraryId))
    if (used.has(renamedTo)) throw new AppError('CLASSIFICATION_CONFLICT', `Tag "${renamedTo}" already exists`)
    const state = loadValueState(db, libraryId, 'tag')
    if (state.has(name) && state.has(renamedTo)) throw new AppError('CLASSIFICATION_CONFLICT', `Tag "${renamedTo}" already exists`)
    db.transaction((tx) => {
      tx.update(libraryMetadataValueState).set({ value: renamedTo, updatedAt: Date.now() })
        .where(and(
          eq(libraryMetadataValueState.libraryId, libraryId),
          eq(libraryMetadataValueState.kind, 'tag'),
          eq(libraryMetadataValueState.value, name),
        )).run()
      tx.update(libraryBookTagValues).set({ name: renamedTo })
        .where(and(
          eq(libraryBookTagValues.name, name),
          sql`${libraryBookTagValues.libraryBookId} IN (SELECT id FROM ${libraryBooks} WHERE ${libraryBooks.libraryId} = ${libraryId})`,
        )).run()
    })
  }

  const effective = renamedTo ?? name
  if (patch.pinned !== undefined || patch.hidden !== undefined) {
    writeState(db, libraryId, 'tag', effective, {
      ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
      ...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
    })
  }
  return listTagValues(actorId, libraryId)
}

export async function reorderTagValues(actorId: string, libraryId: string, names: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const nodes = await listTagValues(actorId, libraryId, { showHidden: true })
  const known = new Set(nodes.map((node) => node.id))
  if (new Set(names).size !== names.length || names.some((name) => !known.has(name))) {
    throw new AppError('CLASSIFICATION_NOT_FOUND', 'Unknown tag value')
  }
  db.transaction((tx) => {
    for (const [index, name] of names.entries()) writeState(tx, libraryId, 'tag', name, { sortOrder: index })
  })
}

/** Remove a tag value from every book in the library; preferences stay. */
export async function clearTagValue(actorId: string, libraryId: string, rawName: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const name = rawName.trim()
  if (!name) throw new AppError('VALIDATION_ERROR', 'A tag name cannot be empty')
  db.delete(libraryBookTagValues).where(and(
    eq(libraryBookTagValues.name, name),
    sql`${libraryBookTagValues.libraryBookId} IN (SELECT id FROM ${libraryBooks} WHERE ${libraryBooks.libraryId} = ${libraryId})`,
  )).run()
  return listTagValues(actorId, libraryId)
}

/** Category values as search-name rows, for `category:` expression binding. */
export function categorySearchNames(db: Db, libraryId: string): Array<{ id: string; name: string; parentId: string | null }> {
  const paths = usedCategoryPaths(db, libraryId)
  const names = new Map<string, { id: string; name: string; parentId: string | null }>()
  for (const path of paths) {
    for (let depth = 1; depth <= path.length; depth += 1) {
      const node = path.slice(0, depth)
      const key = classificationValueKey('category', node)
      if (!names.has(key)) {
        names.set(key, {
          id: key,
          name: node[node.length - 1]!,
          parentId: depth === 1 ? null : classificationValueKey('category', node.slice(0, -1)),
        })
      }
    }
  }
  return [...names.values()]
}

/** Tag values as search-name rows; a tag has no parent and no separate id. */
export function tagSearchNames(db: Db, libraryId: string): Array<{ id: string; name: string; parentId: string | null }> {
  return usedTagNames(db, libraryId).map((name) => ({ id: name, name, parentId: null }))
}
