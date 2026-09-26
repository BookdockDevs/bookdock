import { z } from 'zod'

import type { BookFormat, ReadStatus } from './constants'

/**
 * Target library/city model (library-design-v1 v1.4).
 * Wire shapes only: password hashes, access passwords and session tokens
 * never cross this boundary; they stay server-internal.
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
  author: string
  description: string
  coverKey: string | null
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
  createdAt: number
  updatedAt: number
}

export interface LibraryTag {
  id: string
  libraryId: string
  userId: string
  name: string
  sortOrder: number
  pinned: boolean
  createdAt: number
  updatedAt: number
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
