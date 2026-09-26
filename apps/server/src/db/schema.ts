import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, blob, uniqueIndex, index, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import type { AccessTokenPermission, AiCitation, AiContextReceipt, AiGenerationDiagnostics, AiGenerationUsage, AiNormalizedEvent, AiRetryRecipe, AiThreadSettings, TocRulePattern } from '@bookdock/shared'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  // Trimmed/NFKC/case-folded identity; NULL during the compat window
  // (the UNIQUE index in 0008 ignores NULLs, so backfill in Phase 2 cannot collide).
  usernameNormalized: text('username_normalized').unique(),
  bio: text('bio').notNull().default(''),
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
  // Membership-change time, maintained by DB triggers (0007), not service code
  updatedAt: integer('updated_at').notNull().default(0),
  // Sidebar pin-to-top flag, orthogonal to every sort mode (0007)
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
})

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(0),
  // Membership-change time, maintained by DB triggers (0007), not service code
  updatedAt: integer('updated_at').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
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

export const legadoAccessKeys = sqliteTable('legado_access_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  encryptedToken: text('encrypted_token'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
}, (table) => ({
  userUnique: uniqueIndex('legado_access_keys_user_unique').on(table.userId),
  tokenHashUnique: uniqueIndex('legado_access_keys_token_hash_unique').on(table.tokenHash),
}))

// Operation-scoped access tokens (ADR-24). The plaintext is never stored: only
// its sha256 hash and the last four characters (for list display) are kept.
// There is no revocation field — disabling keeps the row, deleting removes it.
export const accessTokens = sqliteTable('access_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  permissions: text('permissions', { mode: 'json' }).$type<AccessTokenPermission[]>().notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenLast4: text('token_last4').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
  disabledAt: integer('disabled_at'),
}, (table) => ({
  tokenHashUnique: uniqueIndex('access_tokens_token_hash_unique').on(table.tokenHash),
  userCreatedIdx: index('access_tokens_user_created_idx').on(table.userId, table.createdAt),
}))

export const ttsServices = sqliteTable('tts_services', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider', { enum: ['openai', 'azure', 'aliyun', 'dashscope', 'minimax', 'mimo', 'volcengine', 'openai-compatible'] }).notNull(),
  baseUrl: text('base_url'),
  model: text('model'),
  defaultVoice: text('default_voice'),
  options: text('options', { mode: 'json' }).$type<Record<string, string | number | boolean>>().notNull().default({}),
  encryptedSecrets: text('encrypted_secrets'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userNameIdx: uniqueIndex('tts_services_user_name_idx').on(table.userId, table.name),
  userUpdatedIdx: index('tts_services_user_updated_idx').on(table.userId, table.updatedAt),
}))

export const aiThreads = sqliteTable('ai_threads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  // New-model reference (2.8); backfilled by the Phase 2 service, never in SQL.
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  settings: text('settings', { mode: 'json' }).$type<AiThreadSettings | null>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userBookUpdatedIdx: index('ai_threads_user_book_updated_idx').on(table.userId, table.bookId, table.updatedAt),
  versionIdx: index('ai_threads_book_version_idx').on(table.bookVersionId),
}))

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => aiThreads.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  context: text('context', { mode: 'json' }).$type<AiContextReceipt | null>(),
  retry: text('retry', { mode: 'json' }).$type<AiRetryRecipe | null>(),
  citations: text('citations', { mode: 'json' }).$type<AiCitation[] | null>(),
  revisionGroupId: text('revision_group_id'),
  revision: integer('revision').notNull().default(0),
  isSelected: integer('is_selected').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  aborted: integer('aborted').notNull().default(0),
}, (table) => ({
  userThreadCreatedIdx: index('ai_messages_user_thread_created_idx').on(table.userId, table.threadId, table.createdAt),
  revisionGroupIdx: index('ai_messages_revision_group_idx').on(table.userId, table.threadId, table.revisionGroupId, table.revision),
}))

export const aiMessageEvents = sqliteTable('ai_message_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => aiThreads.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => aiMessages.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  type: text('type', { enum: ['tool', 'citation'] }).notNull(),
  phase: text('phase', { enum: ['start', 'result'] }),
  name: text('name'),
  chapterIndex: integer('chapter_index'),
  resultChars: integer('result_chars'),
  citationId: text('citation_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageSequenceUnique: uniqueIndex('ai_message_events_message_sequence_unique').on(table.messageId, table.sequence),
  userThreadCreatedIdx: index('ai_message_events_user_thread_created_idx').on(table.userId, table.threadId, table.createdAt),
}))

export const aiGenerationRuns = sqliteTable('ai_generation_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => aiThreads.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  targetMessageId: text('target_message_id').references(() => aiMessages.id, { onDelete: 'set null' }),
  state: text('state', { enum: ['preparing', 'requesting', 'streaming', 'waiting_tool', 'completed', 'failed', 'cancelled', 'interrupted'] }).notNull(),
  stateRevision: integer('state_revision').notNull().default(0),
  checkpointSeq: integer('checkpoint_seq').notNull().default(0),
  checkpointText: text('checkpoint_text').notNull().default(''),
  checkpointEvents: text('checkpoint_events', { mode: 'json' }).$type<AiNormalizedEvent[] | null>(),
  checkpointUsage: text('checkpoint_usage', { mode: 'json' }).$type<AiGenerationUsage | null>(),
  diagnostics: text('diagnostics', { mode: 'json' }).$type<AiGenerationDiagnostics | null>(),
  errorCode: text('error_code'),
  reason: text('reason', { enum: ['user_cancelled', 'client_disconnected', 'stream_disconnected', 'server_restarted', 'provider_aborted', 'timeout', 'provider_error', 'persistence_error'] }),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  terminalAt: integer('terminal_at'),
}, (table) => ({
  requestUnique: uniqueIndex('ai_generation_runs_request_unique').on(table.requestId),
  userThreadUpdatedIdx: index('ai_generation_runs_user_thread_updated_idx').on(table.userId, table.threadId, table.updatedAt),
  activeUserUnique: uniqueIndex('ai_generation_runs_active_user_unique')
    .on(table.userId)
    .where(sql`${table.state} IN ('preparing', 'requesting', 'streaming', 'waiting_tool')`),
}))

export const aiBookIndexes = sqliteTable('ai_book_indexes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  sourceVersion: text('source_version').notNull(),
  status: text('status', { enum: ['indexing', 'ready', 'failed'] }).notNull(),
  embeddingStatus: text('embedding_status', { enum: ['not_indexed', 'indexing', 'ready', 'failed', 'unavailable'] }).notNull().default('unavailable'),
  embeddingProvider: text('embedding_provider'),
  embeddingModel: text('embedding_model'),
  embeddingDim: integer('embedding_dim'),
  progress: integer('progress').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userBookUnique: uniqueIndex('ai_book_indexes_user_book_unique').on(table.userId, table.bookId),
  userStatusUpdatedIdx: index('ai_book_indexes_user_status_updated_idx').on(table.userId, table.status, table.updatedAt),
  versionIdx: index('ai_book_indexes_book_version_idx').on(table.bookVersionId),
}))

export const aiChunks = sqliteTable('ai_chunks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  indexId: text('index_id').notNull().references(() => aiBookIndexes.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  chapterIndex: integer('chapter_index').notNull(),
  chapterId: text('chapter_id').notNull(),
  chapterTitle: text('chapter_title').notNull(),
  startOffset: integer('start_offset').notNull(),
  endOffset: integer('end_offset').notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userBookChapterIdx: index('ai_chunks_user_book_chapter_idx').on(table.userId, table.bookId, table.chapterIndex, table.startOffset),
  indexIdIdx: index('ai_chunks_index_id_idx').on(table.indexId),
  versionIdx: index('ai_chunks_book_version_idx').on(table.bookVersionId),
}))

export const aiChunkEmbeddings = sqliteTable('ai_chunk_embeddings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  indexId: text('index_id').notNull().references(() => aiBookIndexes.id, { onDelete: 'cascade' }),
  chunkId: text('chunk_id').notNull().references(() => aiChunks.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  dimension: integer('dimension').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  indexChunkUnique: uniqueIndex('ai_chunk_embeddings_index_chunk_unique').on(table.indexId, table.chunkId),
  userBookIdx: index('ai_chunk_embeddings_user_book_idx').on(table.userId, table.bookId, table.indexId),
  versionIdx: index('ai_chunk_embeddings_book_version_idx').on(table.bookVersionId),
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
  chapterHref: text('chapter_href'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  // Notes are exempt: rereads produce new ideas on the same range over time
  userBookCfiTypeIdx: uniqueIndex('annotation_user_book_cfi_type_idx')
    .on(table.userId, table.bookId, table.cfiRange, table.type)
    .where(sql`${table.type} != 'note'`),
}))

// Text replacements (P1): regex/filter rules and point patches share one table,
// discriminated by matchType. Pattern rules are user-global (bookId always null);
// `enabled` is the global default, overridable per book via text_replacement_overrides.
// Point patches are inherently single-book (bookId required) and never overridden.
export const textReplacements = sqliteTable('text_replacements', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  matchType: text('match_type', { enum: ['pattern', 'point'] }).notNull().default('pattern'),
  pattern: text('pattern'),
  replacement: text('replacement'),
  isRegex: integer('is_regex').notNull().default(0),
  applyTo: text('apply_to', { enum: ['content', 'title', 'both'] }).notNull().default('content'),
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
  userBookIdx: index('text_replacements_user_book_idx').on(table.userId, table.bookId),
  versionIdx: index('text_replacements_book_version_idx').on(table.bookVersionId),
}))

// Per-book enable overrides for pattern rules: a row's existence is the override,
// `enabled` is the value for that book. effectiveEnabled = override.enabled ?? rule.enabled
export const textReplacementOverrides = sqliteTable('text_replacement_overrides', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  replacementId: text('replacement_id').notNull().references(() => textReplacements.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  bookReplacementUnique: uniqueIndex('text_replacement_overrides_book_replacement_unique').on(table.bookId, table.replacementId),
  userBookIdx: index('text_replacement_overrides_user_book_idx').on(table.userId, table.bookId),
  versionIdx: index('text_replacement_overrides_book_version_idx').on(table.bookVersionId),
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
// books.meta.tocRuleId stores the selected rule for a book.
export const tocRules = sqliteTable('toc_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  seedKey: text('seed_key'),
  enabled: integer('enabled').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  patterns: text('patterns', { mode: 'json' }).$type<TocRulePattern[]>().notNull().default([]),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userIdx: index('toc_rules_user_idx').on(table.userId, table.sortOrder),
  userSeedKeyUnique: uniqueIndex('toc_rules_user_seed_key_unique').on(table.userId, table.seedKey),
}))

export const readingRecords = sqliteTable('reading_records', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  // Client-local calendar day of the session start ('YYYY-MM-DD'), one row per user+book+day
  date: text('date').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
}, (table) => ({
  userBookDateIdx: uniqueIndex('reading_records_user_book_date_idx').on(table.userId, table.bookId, table.date),
  userDateIdx: index('reading_records_user_date_idx').on(table.userId, table.date),
  versionIdx: index('reading_records_book_version_idx').on(table.bookVersionId),
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
  bookId: text('book_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
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
  versionIdx: index('reading_sessions_book_version_idx').on(table.bookVersionId),
}))

// Library foundation (Phase 1): structure only, no data migration yet.
// `user_id` on libraries/library_books/library_categories/library_tags is
// the owner/tenant key (exposed on the wire as ownerUserId), so the
// per-user scoping rule needs no second column. Source ids on
// library_book_versions and ideas.sharedLibraryId are plain text on purpose:
// provenance must survive the deletion of whatever they point at, which no
// FK cascade/SET NULL/restrict can express.
export const libraries = sqliteTable('libraries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type', { enum: ['private', 'shared'] }).notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visibility: text('visibility', { enum: ['public', 'password', 'private'] }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userTypeIdx: index('libraries_user_type_idx').on(table.userId, table.type),
}))

export const libraryMemberships = sqliteTable('library_memberships', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  libraryUserUnique: uniqueIndex('library_memberships_library_user_unique').on(table.libraryId, table.userId),
  userIdx: index('library_memberships_user_idx').on(table.userId),
}))

export const libraryBooks = sqliteTable('library_books', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  categoryId: text('category_id').references(() => libraryCategories.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  description: text('description').notNull().default(''),
  coverKey: text('cover_key'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  // Soft delete carried over from books.deletedAt; trash behavior cuts over in Phase 3.
  deletedAt: integer('deleted_at'),
}, (table) => ({
  libraryIdx: index('library_books_library_idx').on(table.libraryId, table.updatedAt),
  categoryIdx: index('library_books_category_idx').on(table.categoryId),
}))

export const bookVersions = sqliteTable('book_versions', {
  id: text('id').primaryKey(),
  format: text('format', { enum: ['epub', 'txt'] }).notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const libraryBookVersions = sqliteTable('library_book_versions', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  libraryBookId: text('library_book_id').notNull().references(() => libraryBooks.id, { onDelete: 'cascade' }),
  // Restrict (default NO ACTION): a version with library entries cannot be deleted.
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id),
  kind: text('kind', { enum: ['personal', 'shared', 'local'] }).notNull(),
  status: text('status', { enum: ['published', 'unlisted'] }).notNull().default('published'),
  name: text('name').notNull().default(''),
  // Null = inherit the LibraryBook default; never a copied value.
  title: text('title'),
  author: text('author'),
  description: text('description'),
  coverKey: text('cover_key'),
  sourceLibraryId: text('source_library_id'),
  sourceLibraryBookVersionId: text('source_library_book_version_id'),
  pinnedRevisionId: text('pinned_revision_id').references(() => contentRevisions.id),
  // Sort-first pin carried over from books.pinned_at (private cards keep order).
  pinnedAt: integer('pinned_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  bookIdx: index('library_book_versions_book_idx').on(table.libraryBookId),
  versionIdx: index('library_book_versions_version_idx').on(table.bookVersionId),
  // One B per BookVersion per private library; enforced in service code against
  // (libraryId, bookVersionId, kind) because A/C duplicates are legitimate.
  libraryVersionIdx: index('library_book_versions_library_version_idx').on(table.libraryId, table.bookVersionId),
}))

export const contentRevisions = sqliteTable('content_revisions', {
  id: text('id').primaryKey(),
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  revisionNo: integer('revision_no').notNull(),
  blobKey: text('blob_key').notNull(),
  size: integer('size').notNull(),
  wordCount: integer('word_count'),
  chapterCount: integer('chapter_count').notNull().default(0),
  // Full BookMeta shape (chapters, embedded metadata, reader prefs, TOC pins):
  // the revision that produced the content owns its derived data. Readers
  // prefer this over the frozen legacy books.meta fallback.
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  versionRevisionUnique: uniqueIndex('content_revisions_version_revision_unique').on(table.bookVersionId, table.revisionNo),
  blobIdx: index('content_revisions_blob_idx').on(table.blobKey),
}))

export const blobs = sqliteTable('blobs', {
  key: text('key').primaryKey(),
  size: integer('size').notNull(),
  kind: text('kind', { enum: ['book', 'cover'] }).notNull(),
  createdAt: integer('created_at').notNull(),
})

export const libraryCategories = sqliteTable('library_categories', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  parentId: text('parent_id').references((): AnySQLiteColumn => libraryCategories.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  // Sidebar pin-to-top flag, orthogonal to every sort mode (mirrors shelves.pinned).
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  libraryIdx: index('library_categories_library_idx').on(table.libraryId, table.sortOrder),
  parentIdx: index('library_categories_parent_idx').on(table.parentId),
}))

export const libraryTags = sqliteTable('library_tags', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  libraryNameUnique: uniqueIndex('library_tags_library_name_unique').on(table.libraryId, table.name),
  libraryIdx: index('library_tags_library_idx').on(table.libraryId, table.sortOrder),
}))

export const libraryBookTags = sqliteTable('library_book_tags', {
  libraryBookId: text('library_book_id').notNull().references(() => libraryBooks.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => libraryTags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.libraryBookId, table.tagId] }),
  tagIdx: index('library_book_tags_tag_idx').on(table.tagId),
}))

// Single-row deployment record. Replaces instance_settings once migrated;
// null uploadMaxBytes falls back to the UPLOAD_MAX_BYTES env default.
export const instance = sqliteTable('instance', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  allowRegistration: integer('allow_registration', { mode: 'boolean' }).notNull().default(false),
  allowGuestAccess: integer('allow_guest_access', { mode: 'boolean' }).notNull().default(false),
  uploadMaxBytes: integer('upload_max_bytes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => ({
  userExpiryIdx: index('sessions_user_expiry_idx').on(table.userId, table.expiresAt),
}))

// Phase 0/2 migration ledger (0.4): one row per batch; completed batches
// refuse reruns. Human-readable verification reports land in files, not here.
export const libraryMigrationLog = sqliteTable('library_migration_log', {
  id: text('id').primaryKey(),
  batch: text('batch').notNull(),
  status: text('status', { enum: ['started', 'completed', 'failed'] }).notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
})

// Reading entities (Phase 1): User x BookVersion dimension from day one.
// revisionId and ideas.sharedLibraryId are plain text without FKs: anchors
// and provenance must outlive whatever they point at.
export const bookStates = sqliteTable('book_states', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  readStatus: text('read_status', { enum: ['wishlist', 'reading', 'idle', 'finished', 'abandoned'] }).notNull().default('reading'),
  percent: integer('percent').notNull().default(0),
  cfi: text('cfi'),
  chapter: text('chapter'),
  // Last reading activity (books.last_read_at carry-over); position writes
  // bump updated_at, reading alone bumps last_read_at.
  lastReadAt: integer('last_read_at'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId] }),
}))

export const highlights = sqliteTable('highlights', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id'),
  cfiRange: text('cfi_range').notNull(),
  cfiAnchor: text('cfi_anchor'),
  color: text('color').notNull().default('yellow'),
  style: text('style').notNull().default('highlight'),
  text: text('text').notNull().default(''),
  chapter: text('chapter'),
  chapterHref: text('chapter_href'),
  relocation: text('relocation', { enum: ['ok', 'unresolved'] }).notNull().default('ok'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userVersionIdx: index('highlights_user_version_idx').on(table.userId, table.bookVersionId, table.deletedAt),
  userVersionCfiUnique: uniqueIndex('highlights_user_version_cfi_unique').on(table.userId, table.bookVersionId, table.cfiRange),
}))

export const bookmarks = sqliteTable('bookmarks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id'),
  cfi: text('cfi'),
  chapter: text('chapter'),
  chapterHref: text('chapter_href'),
  title: text('title'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userVersionIdx: index('bookmarks_user_version_idx').on(table.userId, table.bookVersionId, table.deletedAt),
  userVersionCfiUnique: uniqueIndex('bookmarks_user_version_cfi_unique').on(table.userId, table.bookVersionId, table.cfi),
}))

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').references(() => bookVersions.id, { onDelete: 'cascade' }),
  cfiRange: text('cfi_range'),
  cfiAnchor: text('cfi_anchor'),
  color: text('color').notNull().default('yellow'),
  style: text('style').notNull().default('underline'),
  text: text('text').notNull().default(''),
  note: text('note'),
  visibility: text('visibility', { enum: ['private', 'shared'] }).notNull().default('private'),
  sharedLibraryId: text('shared_library_id'),
  chapter: text('chapter'),
  chapterHref: text('chapter_href'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userVersionIdx: index('ideas_user_version_idx').on(table.userId, table.bookVersionId, table.deletedAt),
  sharedIdx: index('ideas_shared_idx').on(table.sharedLibraryId, table.visibility),
}))
