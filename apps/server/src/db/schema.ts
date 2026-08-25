import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core'

import type { TocRulePattern } from '@bookdock/shared'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member', 'guest'] }).notNull().default('owner'),
  disabled: integer('disabled').notNull().default(0),
  avatarKey: text('avatar_key'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  format: text('format', { enum: ['epub', 'txt'] }).notNull(),
  filePath: text('file_path').notNull(),
  coverKey: text('cover_key'),
  contentHash: text('content_hash'),
  size: integer('size').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  readStatus: text('read_status', { enum: ['wishlist', 'reading', 'idle', 'finished', 'abandoned'] }).notNull().default('reading'),
  progress: integer('progress').notNull().default(0),
  pinnedAt: integer('pinned_at'),
  lastReadAt: integer('last_read_at'),
  deletedAt: integer('deleted_at'),
  // Single-shelf membership; null = uncategorized (legitimate state)
  shelfId: text('shelf_id').references(() => shelves.id, { onDelete: 'set null' }),
}, (table) => ({
  userDeletedIdx: index('books_user_deleted_idx').on(table.userId, table.deletedAt),
  contentHashIdx: index('books_content_hash_idx').on(table.contentHash),
  shelfIdx: index('books_shelf_idx').on(table.shelfId),
}))

export const shelves = sqliteTable('shelves', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
})

export const bookTags = sqliteTable('book_tags', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.bookId, table.tagId] }),
  tagIdx: index('book_tags_tag_idx').on(table.tagId),
}))

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
}, (table) => ({
  userKeyIdx: uniqueIndex('settings_user_key_idx').on(table.userId, table.key),
}))

export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  cfiRange: text('cfi_range').notNull(),
  cfiAnchor: text('cfi_anchor'),
  type: text('type', { enum: ['highlight', 'note', 'bookmark'] }).notNull(),
  color: text('color').notNull().default('yellow'),
  style: text('style', { enum: ['underline', 'squiggly', 'highlight'] }).notNull().default('underline'),
  text: text('text').notNull().default(''),
  note: text('note'),
  chapter: text('chapter'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  // Notes are exempt: rereads produce new ideas on the same range over time
  userBookCfiTypeIdx: uniqueIndex('annotation_user_book_cfi_type_idx')
    .on(table.userId, table.bookId, table.cfiRange, table.type)
    .where(sql`${table.type} != 'note'`),
}))

// Text transforms (P1): regex/filter rules and point patches share one table,
// discriminated by matchType. Pattern rules are user-global (bookId always null);
// `enabled` is the global default, overridable per book via text_transform_overrides.
// Point patches are inherently single-book (bookId required) and never overridden.
export const textTransforms = sqliteTable('text_transforms', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
  matchType: text('match_type', { enum: ['pattern', 'point'] }).notNull().default('pattern'),
  pattern: text('pattern'),
  replacement: text('replacement'),
  isRegex: integer('is_regex').notNull().default(0),
  caseSensitive: integer('case_sensitive').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
  name: text('name'),
  // `group` is a SQL reserved word; the column keeps the API field name via the property
  group: text('group_name'),
  // Point-patch anchors (matchType 'point' only)
  spineHref: text('spine_href'),
  textOffset: integer('text_offset'),
  originalText: text('original_text'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userBookIdx: index('text_transforms_user_book_idx').on(table.userId, table.bookId),
}))

// Per-book enable overrides for pattern rules: a row's existence is the override,
// `enabled` is the value for that book. effectiveEnabled = override.enabled ?? rule.enabled
export const textTransformOverrides = sqliteTable('text_transform_overrides', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  transformId: text('transform_id').notNull().references(() => textTransforms.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  bookTransformUnique: uniqueIndex('text_transform_overrides_book_transform_unique').on(table.bookId, table.transformId),
  userBookIdx: index('text_transform_overrides_user_book_idx').on(table.userId, table.bookId),
}))

export const fonts = sqliteTable('fonts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  scope: text('scope', { enum: ['user', 'instance'] }).notNull().default('user'),
  family: text('family').notNull(),
  fileName: text('file_name').notNull(),
  format: text('format', { enum: ['ttf', 'otf', 'woff', 'woff2'] }).notNull(),
  contentHash: text('content_hash').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userContentHashIdx: uniqueIndex('fonts_user_content_hash_idx').on(table.userId, table.contentHash),
  contentHashIdx: index('fonts_content_hash_idx').on(table.contentHash),
}))

// TOC rules (目录规则): named presets of regex patterns that split TXT books
// into chapters. patterns is a JSON array of TocRulePattern (level/regex/
// replacement/name/enabled). sortOrder drives both the picker order and the
// auto-scoring priority (lower wins ties). A book pins one rule via
// books.meta.tocRuleId (legado book.tocUrl analog).
export const tocRules = sqliteTable('toc_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  patterns: text('patterns', { mode: 'json' }).$type<TocRulePattern[]>().notNull().default([]),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userIdx: index('toc_rules_user_idx').on(table.userId, table.sortOrder),
}))

export const readingRecords = sqliteTable('reading_records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  // Client-local calendar day of the session start ('YYYY-MM-DD'), one row per user+book+day
  date: text('date').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
}, (table) => ({
  userBookDateIdx: uniqueIndex('reading_records_user_book_date_idx').on(table.userId, table.bookId, table.date),
  userDateIdx: index('reading_records_user_date_idx').on(table.userId, table.date),
}))

// Fine-grained session detail: one row per reported reading block, kept for
// hour-of-day distribution stats. reading_records stays the daily aggregate.
// Manual-mode sessions (manual reading timer) fill the bounds below — the
// exact start/end time (endedAt) and position recorded in every display unit:
// cfi (precise anchor), fraction (0-1, percent is derived) and chapter index
// (label resolved from books.meta at display time). Auto-mode blocks leave
// them all NULL and are immutable.
export const readingSessions = sqliteTable('reading_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  // Client-local calendar day of the session start ('YYYY-MM-DD')
  date: text('date').notNull(),
  // Nullable for retroactive manual entries recorded without a start time
  startedAt: integer('started_at'),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  endedAt: integer('ended_at'),
  startCfi: text('start_cfi'),
  endCfi: text('end_cfi'),
  startFraction: real('start_fraction'),
  endFraction: real('end_fraction'),
  startChapterIndex: integer('start_chapter_index'),
  endChapterIndex: integer('end_chapter_index'),
}, (table) => ({
  userDateIdx: index('reading_sessions_user_date_idx').on(table.userId, table.date),
}))
