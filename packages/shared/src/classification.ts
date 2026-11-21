import { z } from 'zod'

/**
 * Classification values shared by every surface.
 *
 * A category is a short path of one or two names and a tag is a bare name.
 * Neither is an entity with a lifetime of its own: they exist only as values on
 * a library book, so the canonical identity of a value is the value itself.
 * Preference state (hidden, pinned, manual order) keys on that identity, which
 * is why `classificationValueKey` is the one place a value becomes a key.
 *
 * Paths stay arrays everywhere. Nothing joins them with a separator, because a
 * category name may legitimately contain any punctuation.
 */

export const MAX_CATEGORY_DEPTH = 2
export const MAX_CATEGORY_NAME_LENGTH = 100
export const MAX_TAG_NAME_LENGTH = 100

export type ClassificationKind = 'category' | 'tag'
export const classificationKindSchema = z.enum(['category', 'tag'])

/** Categories or tags on one book entry; a value, not a reference. */
export interface BookClassification {
  /** Null means uncategorized; a real state, not a special category. */
  categoryPath: string[] | null
  tags: string[]
}

export const categoryPathSchema = z.array(z.string().trim().min(1).max(MAX_CATEGORY_NAME_LENGTH))
  .min(1)
  .max(MAX_CATEGORY_DEPTH)

export const tagNameListSchema = z.array(z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH))

/**
 * Trim every name, drop empties, and refuse anything deeper than the two-level
 * limit. Exact duplicates collapse; near-duplicates (case, width, synonyms) are
 * left alone on purpose — merging them is a user decision, never a guess.
 */
export function normalizeCategoryPath(input: readonly string[] | null | undefined): string[] | null {
  if (!input) return null
  const names = input.map((name) => name.trim()).filter(Boolean)
  if (names.length === 0) return null
  if (names.length > MAX_CATEGORY_DEPTH) throw new Error(`Category paths support at most ${MAX_CATEGORY_DEPTH} levels`)
  return names.map((name) => name.slice(0, MAX_CATEGORY_NAME_LENGTH))
}

export function normalizeTagNames(input: readonly string[] | null | undefined): string[] {
  if (!input) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of input) {
    const name = raw.trim().slice(0, MAX_TAG_NAME_LENGTH)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** Canonical preference-state key for one value. Category keys stay structured. */
export function classificationValueKey(kind: ClassificationKind, value: string | readonly string[]): string {
  if (kind === 'tag') return typeof value === 'string' ? value : value.join('')
  const path = typeof value === 'string' ? [value] : value
  return JSON.stringify(path)
}

/** Inverse of `classificationValueKey` for categories; null when malformed. */
export function parseCategoryValueKey(key: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(key)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CATEGORY_DEPTH) return null
    if (parsed.some((name) => typeof name !== 'string' || !name)) return null
    return parsed as string[]
  } catch {
    return null
  }
}

/** Human-readable form of a path, for labels and search terms only. */
export function categoryPathLabel(path: readonly string[] | null | undefined): string {
  return path && path.length > 0 ? path.join(' / ') : ''
}

/** Same path, ignoring nothing: callers compare canonical keys instead. */
export function sameCategoryPath(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((name, index) => name === right[index])
}

/**
 * A category query/filter value: the 'none' sentinel for uncategorized, or a
 * canonical value key. Requests carry keys, never joined path strings, so a
 * name containing punctuation stays unambiguous.
 */
export function parseCategoryQuery(value: string | null | undefined): string[] | 'none' | undefined {
  if (!value) return undefined
  if (value === 'none') return 'none'
  const path = parseCategoryValueKey(value)
  if (!path) throw new Error('Invalid category value')
  return path
}

// ------------------------------------------------ Value maintenance requests

export const categoryValuePatchSchema = z.object({
  path: categoryPathSchema,
  name: z.string().trim().min(1).max(MAX_CATEGORY_NAME_LENGTH).optional(),
  parentPath: categoryPathSchema.nullable().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
})
export type CategoryValuePatchReq = z.infer<typeof categoryValuePatchSchema>

export const categoryValueOrderSchema = z.object({ keys: z.array(z.string().min(1)) })
export const categoryValueClearSchema = z.object({ path: categoryPathSchema })

export const tagValuePatchSchema = z.object({
  name: z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH),
  renamedTo: z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH).optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
})
export type TagValuePatchReq = z.infer<typeof tagValuePatchSchema>

export const tagValueOrderSchema = z.object({ names: z.array(z.string().trim().min(1)) })
export const tagValueClearSchema = z.object({ name: z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH) })
