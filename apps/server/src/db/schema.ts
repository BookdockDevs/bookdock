import { eq, sql } from 'drizzle-orm'
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
  disabled: integer('disabled').notNull().default(0),
  avatarKey: text('avatar_key'),
  // IANA zone reported by the client, used only to render timestamps the server
  // formats (the Legado book source). NULL means UTC, which is what a server
  // rendering for an unidentified reader has to assume anyway.
  timezone: text('timezone'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

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
  // Execution + display order (ascending). New and imported rules append at
  // max(sortOrder)+1; backfilled once per user by createdAt in 0038.
  sortOrder: integer('sort_order').notNull().default(0),
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
// (label resolved from revision metadata at display time). Auto-mode blocks leave
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
  accessPassword: text('access_password'),
  // Scrypt hash for password-visibility libraries; null otherwise. Never
  // exposed through shared contracts.
  accessPasswordHash: text('access_password_hash'),
  // Shared-library trash settings (per-library, owner-only). NULL = default
  // (enabled on, 30d retention, unlimited capacity); private rows stay NULL.
  trashEnabled: integer('trash_enabled', { mode: 'boolean' }),
  trashAutoCleanDays: integer('trash_auto_clean_days'),
  trashMaxBytes: integer('trash_max_bytes'),
  // Per-library member-upload switch (owner-only). Members may upload new
  // works/versions and maintain versions they uploaded; default off.
  allowMemberUpload: integer('allow_member_upload', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userTypeIdx: index('libraries_user_type_idx').on(table.userId, table.type),
  // Exactly one private library per user. The partial index (not a plain
  // unique on userId) leaves shared-library ownership untouched.
  privateUserUnique: uniqueIndex('libraries_private_user_unique').on(table.userId).where(eq(table.type, 'private')),
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
  // Full author list (max 10); `author` above mirrors authors[0] ?? '' as a
  // derived-at-write scalar for sort/filter/search (see architecture.md).
  authors: text('authors', { mode: 'json' }).$type<string[]>().notNull().default([]),
  description: text('description').notNull().default(''),
  coverKey: text('cover_key'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  // Soft delete carried over from books.deletedAt; trash behavior cuts over in Phase 3.
  deletedAt: integer('deleted_at'),
  // Work-level hide (see Hidden boundary in architecture.md): excluded from
  // reads unless the viewer may see hidden rows, never deleted.
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  // Shared-library home cards represent works; private cards keep their pin on the version link.
  pinnedAt: integer('pinned_at'),
  // Default display version: the version cards, rows and the detail dialog
  // lead with. Null = oldest upload first. Plain text on purpose like the
  // source ids below: a schema-level references() back into
  // library_book_versions would close a type-inference cycle between the two
  // tables. The database-level FOREIGN KEY in migration 0027 still clears
  // this to NULL when the referenced version row goes.
  defaultVersionLinkId: text('default_version_link_id'),
  // Work-level publication metadata overrides (publisher, language, ISBN,
  // subjects, series): rarely-queried fields live in JSON, mirroring
  // books.meta; effective.bookmeta merges these over the parsed revision meta.
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
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

export const libraryInvites = sqliteTable('library_invites', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
}, (table) => ({
  libraryUnique: uniqueIndex('library_invites_library_unique').on(table.libraryId),
}))

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
  // Full author list override (null = inherit); mirrors the work rule above.
  authors: text('authors', { mode: 'json' }).$type<string[] | null>(),
  description: text('description'),
  coverKey: text('cover_key'),
  // Version-level publication metadata overrides (publisher, language, ISBN,
  // subjects, series): {} = inherit the work default, mirroring the
  // title/author/description override rule; effective.bookmeta merges these
  // over the work-level overrides and the parsed revision meta.
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  sourceLibraryId: text('source_library_id'),
  sourceLibraryBookVersionId: text('source_library_book_version_id'),
  // Publish-time base of this listing: which private version+revision the
  // snapshot was taken from. Plain text (no FK) like the other source ids so
  // the base stays readable as provenance after the source is deleted; a
  // missing base means published before base tracking (collectible as usual).
  sourceBaseVersionId: text('source_base_version_id'),
  sourceBaseRevisionId: text('source_base_revision_id'),
  // Link creator (uploader/collector/forker). Maintainer checks compare it
  // against the actor; old rows stay null (managers only). Plain text (no
  // FK) so user deletion never blocks on it — orphaned links simply lose
  // their maintainer and fall back to managers-only.
  userId: text('user_id'),
  pinnedRevisionId: text('pinned_revision_id').references(() => contentRevisions.id),
  // Sort-first pin carried over from books.pinned_at (private cards keep order).
  pinnedAt: integer('pinned_at'),
  // Per-listing anonymous readability: one library's guest switch never opens
  // another library's copy of the same version. Takes effect only inside a
  // public library on a guest-enabled instance (see resolveSharedVersionRead).
  guestReadable: integer('guest_readable', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  bookIdx: index('library_book_versions_book_idx').on(table.libraryBookId),
  versionIdx: index('library_book_versions_version_idx').on(table.bookVersionId),
  // One B per BookVersion per private library; enforced in service code against
  // (libraryId, bookVersionId, kind) because A/C duplicates are legitimate.
  libraryVersionIdx: index('library_book_versions_library_version_idx').on(table.libraryId, table.bookVersionId),
  // "Which city listings were published from this private book?", read on
  // every private-book detail to build the publish dialog's targets.
  sourceBaseIdx: index('library_book_versions_source_base_idx').on(table.sourceBaseVersionId),
  // The database backstop for that rule: only shared (B) rows are constrained,
  // so legitimate A/C duplicates in the same library keep working.
  sharedVersionUnique: uniqueIndex('library_book_versions_shared_unique')
    .on(table.libraryId, table.bookVersionId).where(eq(table.kind, 'shared')),
}))

export const contentRevisions = sqliteTable('content_revisions', {
  id: text('id').primaryKey(),
  bookVersionId: text('book_version_id').notNull().references(() => bookVersions.id, { onDelete: 'cascade' }),
  revisionNo: integer('revision_no').notNull(),
  blobKey: text('blob_key').notNull(),
  size: integer('size').notNull(),
  wordCount: integer('word_count'),
  chapterCount: integer('chapter_count').notNull().default(0),
  // Full content metadata shape (chapters, embedded metadata, TOC pins):
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
  storageTier: text('storage_tier', { enum: ['local', 'synced', 'remote'] }).notNull().default('local'),
  lastAccessedAt: integer('last_accessed_at'),
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
  // Persistent taxonomy hide (see Hidden boundary): hides the subtree and
  // every work filed under it; evaluated at read time.
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
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
  // Persistent taxonomy hide (see Hidden boundary): hides every work carrying
  // the tag; evaluated at read time.
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
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
  // Operator-run city switches; both default open. The instance owner always
  // bypasses them (see isInstanceOwner + the upload/create gates).
  allowUserCreateLibrary: integer('allow_user_create_library', { mode: 'boolean' }).notNull().default(true),
  allowUserUpload: integer('allow_user_upload', { mode: 'boolean' }).notNull().default(true),
  storageBackendEnabled: integer('storage_backend_enabled', { mode: 'boolean' }).notNull().default(false),
  storageBackendConnectionId: text('storage_backend_connection_id').references(() => storageConnections.id, { onDelete: 'set null' }),
  storageBackendBasePath: text('storage_backend_base_path').notNull().default('/Bookdock/storage'),
  storageBackendCacheMaxMb: integer('storage_backend_cache_max_mb').notNull().default(2048),
  storageBackendStatus: text('storage_backend_status', { enum: ['active', 'disabled', 'error'] }).notNull().default('disabled'),
  storageBackendLastTestedAt: integer('storage_backend_last_tested_at'),
  storageBackendLatencyMs: integer('storage_backend_latency_ms'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const storageTransferTasks = sqliteTable('storage_transfer_tasks', {
  id: text('id').primaryKey(),
  blobKey: text('blob_key').notNull(),
  taskType: text('task_type', { enum: ['archive', 'migrate', 'restore'] }).notNull(),
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  statusIdx: index('storage_transfer_tasks_status_idx').on(table.status),
  blobKeyIdx: index('storage_transfer_tasks_blob_key_idx').on(table.blobKey),
}))

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
  /**
   * The content revision this reader last opened. The pin moves for every
   * holder at once, so only this separates one account's "seen it" from
   * another's. Null = never opened the reader, which counts as having an
   * update once any revision exists. Plain text: a deleted revision leaves it
   * dangling and the row simply reads as "has an update".
   */
  readRevisionId: text('read_revision_id'),
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
  contextText: text('context_text'),
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
  sourceLibraryBookVersionId: text('source_library_book_version_id'),
  revisionId: text('revision_id'),
  editedAt: integer('edited_at'),
  chapter: text('chapter'),
  chapterHref: text('chapter_href'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, (table) => ({
  userVersionIdx: index('ideas_user_version_idx').on(table.userId, table.bookVersionId, table.deletedAt),
  sharedIdx: index('ideas_shared_idx').on(table.sharedLibraryId, table.visibility),
}))

export const ideaComments = sqliteTable('idea_comments', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => ideaComments.id, { onDelete: 'cascade' }),
  replyToId: text('reply_to_id').references((): AnySQLiteColumn => ideaComments.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
  editedAt: integer('edited_at'),
  deletedAt: integer('deleted_at'),
}, (table) => ({ ideaIdx: index('idea_comments_idea_idx').on(table.ideaId, table.createdAt) }))

export const ideaLikes = sqliteTable('idea_likes', {
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.ideaId, table.userId] }) }))

export const ideaCommentLikes = sqliteTable('idea_comment_likes', {
  commentId: text('comment_id').notNull().references(() => ideaComments.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.commentId, table.userId] }) }))

export const storageConnections = sqliteTable('storage_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').notNull().default('webdav'),
  endpoint: text('endpoint').notNull(),
  username: text('username').notNull(),
  encryptedPassword: text('encrypted_password'),
  basePath: text('base_path').notNull().default('/'),
  region: text('region').notNull().default(''),
  bucket: text('bucket').notNull().default(''),
  // Legacy: the default-connection concept was removed (it only ever drove
  // list ordering). The column stays so no data migration is needed.
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  userIdx: index('storage_connections_user_idx').on(table.userId),
}))

