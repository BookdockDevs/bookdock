import { z } from 'zod'

import type { BookFormat, ReadStatus } from './constants'
import type { BookMetadata } from './contract'

/**
 * Target library/city model (library-design-v1 v1.4).
 * Wire shapes only: session tokens, scrypt password hashes and API tokens
 * never cross this boundary; they stay server-internal.
 *
 * One deliberate exception: a password-visibility library's access password is
 * stored and returned in plaintext (`accessPassword`), and only ever to the
 * library owner. The owner has to be able to read it back to re-share it, which
 * a hash cannot do, so the contract carries it. Members and guests never see
 * the field — the server omits it for anyone who is not the owner.
 */

// ---------------------------------------------------------------- Library

export type LibraryType = 'private' | 'shared'
export const libraryTypeSchema = z.enum(['private', 'shared'])

export type LibraryVisibility = 'public' | 'password' | 'private'
export const libraryVisibilitySchema = z.enum(['public', 'password', 'private'])

export interface Library {
  id: string
  type: LibraryType
  ownerUserId: string
  name: string
  description: string
  /** Null for private libraries, which sit outside the visibility system. */
  visibility: LibraryVisibility | null
  accessPassword?: string | null
  createdAt: number
  updatedAt: number
}

export type MembershipRole = 'admin' | 'member'
export const membershipRoleSchema = z.enum(['admin', 'member'])

export interface LibraryMembership {
  id: string
  libraryId: string
  userId: string
  role: MembershipRole
  createdAt: number
  updatedAt: number
}

/** ACL computation result for one request against one library; never a role. */
export type LibraryRelation = 'owner' | 'admin' | 'member' | 'non-member' | 'guest'
export const libraryRelationSchema = z.enum(['owner', 'admin', 'member', 'non-member', 'guest'])

/**
 * A library as the reader sees it in a list. The relation travels with the row
 * so a sidebar can offer "join" or "manage" without a request per library, and
 * the head counts let a list or a details panel describe a library without a
 * second round-trip.
 */
export interface LibraryListItem extends Library {
  relation: LibraryRelation
  /** Membership rows plus the owner, who holds none of his own. */
  memberCount: number
  /**
   * Works this reader can actually open here: trashed works never count, and for
   * a plain member hidden works and works without a published version are left
   * out so the number matches the catalog they are about to open. Hidden
   * categories and tags are a listing concern and do not subtract.
   */
  workCount: number
  ownerUsername: string
}

export const libraryCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(2000).default(''),
  visibility: libraryVisibilitySchema.default('private'),
  /** Only meaningful with visibility 'password'; cleared otherwise. */
  accessPassword: z.string().min(4).max(128).optional(),
})

export type LibraryCreateReq = z.infer<typeof libraryCreateSchema>

export const libraryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(2000).optional(),
  visibility: libraryVisibilitySchema.optional(),
  accessPassword: z.string().min(4).max(128).nullable().optional(),
})

export type LibraryUpdateReq = z.infer<typeof libraryUpdateSchema>

export const libraryJoinSchema = z.object({
  /** Required for password libraries; rejected elsewhere. */
  accessPassword: z.string().max(128).optional(),
})

export type LibraryJoinReq = z.infer<typeof libraryJoinSchema>

export const libraryInviteTokenSchema = z.object({
  // 16-character Crockford base32 (I/L/O/U excluded so a code read off a
  // screenshot or retyped by hand cannot be mistyped into an invalid one).
  token: z.string().regex(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/),
})

export type LibraryInviteTokenReq = z.infer<typeof libraryInviteTokenSchema>

export interface LibraryInviteStatus {
  active: boolean
  createdAt: number | null
  token: string | null
}

export interface LibraryInvitePreview {
  libraryId: string
  name: string
  description: string
  relation: LibraryRelation
  /** Head counts, scoped to the reader exactly like the library list rows. */
  memberCount: number
  workCount: number
}

/**
 * Adding a member. The target is an existing account, given either by id or by
 * username — a management UI has no user directory to pick from, and an id is
 * not something a human can read off another screen.
 */
export const membershipManageSchema = z.object({
  userId: z.string().min(1).max(128).optional(),
  username: z.string().trim().min(1).max(64).optional(),
  role: membershipRoleSchema,
}).refine((value) => Boolean(value.userId || value.username), {
  message: 'userId or username is required',
  path: ['userId'],
})

export type MembershipManageReq = z.infer<typeof membershipManageSchema>

export interface LibraryMemberEntry {
  id: string
  userId: string
  username: string
  avatarKey?: string | null
  role: MembershipRole
  createdAt: number
  updatedAt: number
}

export interface LibraryMembersRes {
  owner: { id: string; username: string; avatarKey?: string | null; createdAt?: number } | null
  members: LibraryMemberEntry[]
}

// ------------------------------------------------- Book layering (A / B / C)

/** personal = A (own upload), shared = B (city reference), local = C (forked). */
export type LibraryVersionKind = 'personal' | 'shared' | 'local'
export const libraryVersionKindSchema = z.enum(['personal', 'shared', 'local'])

export type LibraryVersionStatus = 'published' | 'unlisted'
export const libraryVersionStatusSchema = z.enum(['published', 'unlisted'])

export interface LibraryBook {
  id: string
  libraryId: string
  /** Null = uncategorized; a real state, not a special category. */
  categoryId: string | null
  title: string
  /** Derived first-author mirror of `authors`; sort/filter/search use this. */
  author: string
  /** Full author list, max 10. */
  authors: string[]
  description: string
  coverKey: string | null
  /** Work-level hide (see Hidden boundary in architecture.md). */
  hidden: boolean
  createdAt: number
  updatedAt: number
}

export interface LibraryBookVersion {
  id: string
  libraryId: string
  libraryBookId: string
  bookVersionId: string
  kind: LibraryVersionKind
  status: LibraryVersionStatus
  /** Version label managed inside the library, e.g. the edition name. */
  name: string
  /** Null = inherit the LibraryBook default; never a copied value. */
  title: string | null
  author: string | null
  /** Full author list override (null = inherit). */
  authors: string[] | null
  description: string | null
  coverKey: string | null
  /** B only: the single source city/version this reference is bound to. */
  sourceLibraryId: string | null
  sourceLibraryBookVersionId: string | null
  /** B only: pinned revision; never follows the source automatically. */
  pinnedRevisionId: string | null
  createdAt: number
  updatedAt: number
}

/** Stable content identity. Initial rows reuse the legacy book id (0.3). */
export interface BookVersion {
  id: string
  format: BookFormat
  size: number
  createdAt: number
  updatedAt: number
}

// --------------------------------------------------------- Catalog (5.x)

/**
 * A library entry as the catalog shows it: work defaults plus every version the
 * library manages, each with its metadata already resolved (null override =
 * inherit). Raw override columns stay on the row; consumers read `effective`.
 */
export interface CatalogVersion {
  id: string
  libraryBookId: string
  bookVersionId: string
  kind: LibraryVersionKind
  status: LibraryVersionStatus
  name: string
  /** Null when the version inherits the work defaults. */
  title: string | null
  author: string | null
  /** Full author list override (null = inherit). */
  authors: string[] | null
  description: string | null
  coverKey: string | null
  /**
   * Raw version-level publication metadata overrides (what the manager wrote,
   * not the merged view). Empty = inherit the work default. Editors must
   * round-trip unknown keys through this object; consumers display `effective`.
   */
  meta: Record<string, unknown>
  effective: {
    title: string
    author: string
    /** Resolved full author list. */
    authors: string[]
    description: string
    coverKey: string | null
    /** Stable key used for the automatic placeholder-cover palette. */
    coverPaletteKey?: string | null
    /** Parsed publication metadata of this version's latest revision. */
    bookmeta: BookMetadata
  /** Original uploaded file name, surviving later title edits. */
  fileName: string | null
  }
  /** Whether this version already has a B entry in the current user's private library. */
  collected?: boolean
  /**
   * Per-listing anonymous switch. Only takes effect with public visibility
   * and the instance guest switch; one library's value never opens another
   * library's copy of the same version.
   */
  guestReadable: boolean
  format: BookFormat
  size: number
  chapterCount: number
  wordCount: number | null
  createdAt: number
  updatedAt: number
}

export interface CatalogBookTag {
  id: string
  name: string
}

export interface CatalogBook {
  id: string
  libraryId: string
  categoryId: string | null
  title: string
  author: string
  /** Full author list, max 10. */
  authors: string[]
  description: string
  coverKey: string | null
  /**
   * Raw work-level publication metadata overrides (what the manager wrote,
   * not the merged view). Empty = nothing overridden. Editors must
   * round-trip unknown keys through this object; consumers display `effective`.
   */
  meta: Record<string, unknown>
  /** Work-level hide; managers see hidden works badged, members never see them. */
  hidden: boolean
  /**
   * Effective hide: direct hide or hidden through a hidden category/tag.
   * Badge on this, never on `hidden` alone. Members never receive such rows.
   */
  effectiveHidden: boolean
  /** Shared-library home pin. Every version of this work shares one card. */
  pinnedAt: number | null
  /**
   * Default display version: cards, rows and the detail dialog lead with this
   * version instead of the oldest upload. Null = oldest first.
   */
  defaultVersionLinkId: string | null
  /**
   * The work's own tags in the library's taxonomy. Carries the name, not just
   * the id, so a catalog card can render them without a second lookup.
   */
  tags: CatalogBookTag[]
  versions: CatalogVersion[]
  createdAt: number
  updatedAt: number
}

export interface CatalogListRes {
  items: CatalogBook[]
  total: number
  page: number
  pageSize: number
}

export interface BatchSelectionItem {
  id: string
  categoryId: string | null
  tagIds: string[]
  hidden: boolean
  pinnedAt: number | null
  /** Private-library entries have one version; shared works may have several. */
  versionCount: number
  /** Present only for private-library entries. */
  kind?: LibraryVersionKind
}

export const batchSelectionSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(2000),
})

export const batchOrganizeSchema = batchSelectionSchema.extend({
  categoryId: z.string().min(1).max(128).nullable().optional(),
  addTagIds: z.array(z.string().min(1).max(128)).default([]),
  removeTagIds: z.array(z.string().min(1).max(128)).default([]),
})

export type BatchOrganizeReq = z.infer<typeof batchOrganizeSchema>

/** Multipart placement fields; everything is optional and library-scoped. */
/** Full author list for uploads and edits: trimmed, 1–100 chars each, max 10. */
export const authorListSchema = z.array(z.string().trim().min(1).max(100)).max(10)

export const MAX_AUTHORS = 10

/**
 * Author normalization for writes (multi-author): `authors` is the source of
 * truth, `author` mirrors `authors[0] ?? ''` as a derived-at-write scalar so
 * sort/filter/search keep working on one column. Either side may be omitted:
 * an explicit `authors` wins, otherwise a lone `author` becomes one element.
 */
export function normalizeAuthors(input?: { author?: string | null; authors?: string[] | null }): { author: string; authors: string[] } {
  const authors = [...new Set((input?.authors ?? []).map((name) => name.trim()).filter(Boolean))].slice(0, MAX_AUTHORS)
  if (authors.length > 0) return { author: authors[0]!, authors }
  const single = (input?.author ?? '').trim()
  return single ? { author: single, authors: [single] } : { author: '', authors: [] }
}

export const catalogUploadSchema = z.object({
  /** Existing work to attach this version to (5.2); omit to create one. */
  libraryBookId: z.string().min(1).max(128).optional(),
  /** Library category (the catalog's own taxonomy). */
  categoryId: z.string().min(1).max(128).optional(),
  tagIds: z.array(z.string().min(1).max(128)).optional(),
  /** Version label inside the library, e.g. the edition name. */
  name: z.string().trim().max(120).optional(),
  /** Work defaults; omitted fields fall back to the parsed file metadata. */
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(300).optional(),
  authors: authorListSchema.optional(),
})

export type CatalogUploadReq = z.infer<typeof catalogUploadSchema>

export const catalogBookUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(300).optional(),
  authors: authorListSchema.optional(),
  description: z.string().max(4000).optional(),
  categoryId: z.string().min(1).max(128).nullable().optional(),
  /** Replaces the work's whole tag set; every id must belong to this library. */
  tagIds: z.array(z.string().min(1).max(128)).optional(),
  /** Work-level hide; manager-only like every other catalog write. */
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  /** Work-level publication metadata overrides (publisher, language, ISBN, subjects, series). */
  meta: z.record(z.string(), z.unknown()).optional(),
  /**
   * Default display version: must belong to this work; null clears back to
   * oldest-first. Manager-only like every other catalog write.
   */
  defaultVersionLinkId: z.string().min(1).max(128).nullable().optional(),
})

export type CatalogBookUpdateReq = z.infer<typeof catalogBookUpdateSchema>

/** Version overrides: null clears an override and restores inheritance. */
export const catalogVersionUpdateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1).max(300).nullable().optional(),
  author: z.string().trim().max(300).nullable().optional(),
  authors: authorListSchema.nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  status: libraryVersionStatusSchema.optional(),
  /**
   * Version-level publication metadata overrides (publisher, language, ISBN,
   * subjects, series). Replaces the whole override object; null clears it
   * back to inheriting the work default.
   */
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type CatalogVersionUpdateReq = z.infer<typeof catalogVersionUpdateSchema>

/** 5.5: re-group a misfiled version under another work of the same library. */
export const catalogVersionMoveSchema = z.object({
  libraryBookId: z.string().min(1).max(128),
})

/**
 * 5.2 grouping hint. The server only ranks candidates inside one library;
 * deciding whether a version belongs to a work stays a human choice.
 */
export const catalogSimilarQuerySchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional(),
  excludeLibraryBookId: z.string().min(1).max(128).optional(),
})

export interface ContentRevision {
  id: string
  bookVersionId: string
  revisionNo: number
  blobKey: string
  size: number
  wordCount: number | null
  chapterCount: number
  createdAt: number
}

export type BlobKind = 'book' | 'cover'
export const blobKindSchema = z.enum(['book', 'cover'])

export interface BlobRef {
  key: string
  size: number
  kind: BlobKind
  createdAt: number
}

// ------------------------------------------------------- Category / Tag

export interface Category {
  id: string
  libraryId: string
  userId: string
  name: string
  parentId: string | null
  sortOrder: number
  pinned: boolean
  /** Persistent taxonomy hide: hides the subtree and every work under it. */
  hidden: boolean
  createdAt: number
  updatedAt: number
  /** Works filed under this category, trashed works excluded. */
  bookCount: number
}

export interface LibraryTag {
  id: string
  libraryId: string
  userId: string
  name: string
  sortOrder: number
  pinned: boolean
  /** Persistent taxonomy hide: hides every work carrying the tag. */
  hidden: boolean
  createdAt: number
  updatedAt: number
  /** Works carrying this tag, trashed works excluded. */
  bookCount: number
}

// --------------------------------------------------------- Collect (7.x)

/**
 * Add-to-private (7.1). The caller must already be able to read the version;
 * the server copies the effective metadata, pins the current revision and binds
 * the single source. Idempotent per BookVersion (7.5).
 */
export const collectBookSchema = z.object({
  categoryId: z.string().min(1).max(128).optional(),
  tagIds: z.array(z.string().min(1).max(128)).optional(),
})

export type CollectBookReq = z.infer<typeof collectBookSchema>

export interface CollectBookRes {
  libraryBookId: string
  bookVersionId: string
  /** The BookVersion was already collected; the original source is unchanged. */
  alreadyExists: boolean
  sourceLibraryId: string
  sourceLibraryBookVersionId: string
}

/** Publish a private A entry into a managed shared library as an independent snapshot. */
export const publishPrivateBookSchema = z.object({
  bookId: z.string().min(1).max(128),
  categoryId: z.string().min(1).max(128).optional(),
  tagIds: z.array(z.string().min(1).max(128)).optional(),
})

export type PublishPrivateBookReq = z.infer<typeof publishPrivateBookSchema>

export interface PublishPrivateBookRes {
  libraryBookId: string
  versionLinkId: string
  bookVersionId: string
  duplicated: boolean
}

/** Where a private card came from (7.7). Null for A and C. */
export interface BookSourceInfo {
  libraryId: string
  libraryBookVersionId: string | null
  /** Null once the source library is deleted; the id is still kept. */
  libraryName: string | null
}

// ------------------------------------------------------- Reading data

/**
 * Current position/state per User x BookVersion.
 * Interval and speed samples stay in storage files under the same
 * BookVersion dimension; the split is settled when the service lands.
 */
export interface BookState {
  userId: string
  bookVersionId: string
  readStatus: ReadStatus
  percent: number
  cfi: string | null
  chapter: string | null
  updatedAt: number
}

export type RelocationStatus = 'ok' | 'unresolved'

export interface Highlight {
  id: string
  userId: string
  bookVersionId: string
  revisionId: string | null
  cfiRange: string
  cfiAnchor: string | null
  color: string
  style: string
  text: string
  chapter: string | null
  chapterHref: string | null
  relocation: RelocationStatus
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Bookmark {
  id: string
  userId: string
  bookVersionId: string
  revisionId: string | null
  cfi: string | null
  chapter: string | null
  title: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type IdeaVisibility = 'private' | 'shared'
export const ideaVisibilitySchema = z.enum(['private', 'shared'])

export interface Idea {
  id: string
  userId: string
  bookVersionId: string | null
  cfiRange: string | null
  text: string
  note: string | null
  visibility: IdeaVisibility
  /** Set only when shared: the single library this idea is shared to. */
  sharedLibraryId: string | null
  chapter: string | null
  chapterHref: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

// ------------------------------------------------------- Identity

/** Public user DTO. No password hash, no instance role. */
export interface LibraryUser {
  id: string
  username: string
  usernameNormalized: string
  bio: string
  avatarKey: string | null
  createdAt: number
  updatedAt: number
}

/** Owner-only management view; never sent to the profile owner. */
export interface ManagedUser extends LibraryUser {
  disabled: boolean
}

/** Single-row instance record; PK representation follows the Drizzle schema. */
export interface Instance {
  id: string
  ownerUserId: string
  allowRegistration: boolean
  allowGuestAccess: boolean
  uploadMaxBytes: number
  createdAt: number
  updatedAt: number
}

/** Client-visible session subset. The raw token never leaves the server. */
export interface SessionInfo {
  id: string
  createdAt: number
  expiresAt: number
  current: boolean
}

/** Request identity: authenticated user or anonymous guest (user = null). */
export interface AuthContext {
  user: LibraryUser | null
  guest: boolean
}
