import { eq, sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import type { ReadingTimeFragment, ReadingCoverageInterval, AccessTokenPermission, ActivityAudience, ActivityEventType, AiCitation, AiContextReceipt, AiGenerationDiagnostics, AiGenerationUsage, AiNormalizedEvent, AiRetryRecipe, AiThreadSettings, TocRulePattern } from '@bookdock/shared'
import type { ProgressFileData } from '../lib/progress-file'

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
  bookId: text('book_id').notNull(),
  bookVersionId: text('book_version_id'),
  // Calendar day attributed by the reading ledger ('YYYY-MM-DD'), one row per user+book+day
  date: text('date').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  factVersion: integer('fact_version').notNull().default(0),
  wordUnits: integer('word_units'),
  wordState: text('word_state', { enum: ['known', 'partial', 'unknown'] }).notNull().default('unknown'),
  progressDelta: real('progress_delta').notNull().default(0),
  coverage: text('coverage', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
}, (table) => ({
  userBookDateIdx: uniqueIndex('reading_records_user_book_date_idx').on(table.userId, table.bookId, table.date),
  userDateIdx: index('reading_records_user_date_idx').on(table.userId, table.date),
  versionIdx: index('reading_records_book_version_idx').on(table.bookVersionId),
}))

export const readingArchives = sqliteTable('reading_archives', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  title: text('title').notNull(),
  author: text('author').notNull().default(''),
  format: text('format').$type<'epub' | 'txt' | null>(),
  coverKey: text('cover_key'),
  legacyIntervals: text('legacy_intervals', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
  legacyDaily: text('legacy_daily', { mode: 'json' }).$type<{ date: string; durationSeconds: number }[]>().notNull().default([]),
  legacyWordCount: integer('legacy_word_count'),
  legacyRevisionId: text('legacy_revision_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId] }),
}))

export const readingRounds = sqliteTable('reading_rounds', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  status: text('status', { enum: ['reading', 'finished', 'abandoned'] }).notNull().default('reading'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
}, (table) => ({
  userVersionOrdinalIdx: uniqueIndex('reading_rounds_user_version_ordinal_idx').on(table.userId, table.bookVersionId, table.ordinal),
  activeIdx: uniqueIndex('reading_rounds_active_idx').on(table.userId, table.bookVersionId).where(sql`${table.status} = 'reading'`),
}))

export const readingTimerClaims = sqliteTable('reading_timer_claims', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull(),
  mode: text('mode', { enum: ['auto', 'manual'] }).notNull(),
  activityAt: integer('activity_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const readingSessions = sqliteTable('reading_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull(),
  bookVersionId: text('book_version_id'),
  // Calendar day attributed by the reading ledger ('YYYY-MM-DD')
  date: text('date').notNull(),
  sortDate: text('sort_date').notNull().default(''),
  sortStartedAt: integer('sort_started_at').notNull().default(0),
  // Nullable for retroactive manual entries recorded without a start time
  startedAt: integer('started_at'),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  endedAt: integer('ended_at'),
  requestId: text('request_id'),
  bodyHash: text('body_hash'),
  source: text('source', { enum: ['auto', 'manual', 'retroactive', 'legacy'] }).notNull().default('legacy'),
  roundId: text('round_id').references(() => readingRounds.id, { onDelete: 'cascade' }),
  timezone: text('timezone'),
  fragments: text('fragments', { mode: 'json' }).$type<ReadingTimeFragment[]>().notNull().default([]),
  coverage: text('coverage', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
  revisionId: text('revision_id'),
  wordCount: integer('word_count'),
  startCfi: text('start_cfi'),
  endCfi: text('end_cfi'),
  startFraction: real('start_fraction'),
  endFraction: real('end_fraction'),
  startChapterIndex: integer('start_chapter_index'),
  endChapterIndex: integer('end_chapter_index'),
}, (table) => ({
  userRequestIdx: uniqueIndex('reading_sessions_user_request_idx').on(table.userId, table.requestId),
  roundIdx: index('reading_sessions_round_idx').on(table.roundId),
  userDateIdx: index('reading_sessions_user_date_idx').on(table.userId, table.date),
  userBookIdIdx: index('reading_sessions_user_book_id_idx').on(table.userId, table.bookId, table.id),
  userBookSortIdx: index('reading_sessions_user_book_sort_idx').on(table.userId, table.bookId, table.sortDate, table.sortStartedAt, table.id),
  versionIdx: index('reading_sessions_book_version_idx').on(table.bookVersionId),
}))

export const readingWriteReceipts = sqliteTable('reading_write_receipts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  bookVersionId: text('book_version_id').notNull(),
  bodyHash: text('body_hash').notNull(),
  sessionId: text('session_id').references(() => readingSessions.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['accepted', 'skipped', 'deleted'] }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.requestId] }),
  versionIdx: index('reading_write_receipts_user_version_idx').on(table.userId, table.bookVersionId),
}))

export const readingProjectionStates = sqliteTable('reading_projection_states', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  factVersion: integer('fact_version').notNull().default(0),
  algorithmVersion: integer('algorithm_version').notNull().default(1),
  contentRevisionId: text('content_revision_id'),
  contentWordCount: integer('content_word_count'),
  status: text('status', { enum: ['ready', 'failed'] }).notNull().default('ready'),
  error: text('error'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId] }),
  userVersionIdx: index('reading_projection_states_user_version_idx').on(table.userId, table.bookVersionId, table.factVersion),
}))

export const readingContributions = sqliteTable('reading_contributions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  sessionId: text('session_id').references(() => readingSessions.id, { onDelete: 'cascade' }),
  roundId: text('round_id').references(() => readingRounds.id, { onDelete: 'cascade' }),
  contributionKey: text('contribution_key').notNull(),
  date: text('date').notNull(),
  hour: integer('hour'),
  durationSeconds: integer('duration_seconds').notNull(),
  wordUnits: integer('word_units'),
  coverage: text('coverage', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
}, (table) => ({
  uniqueKey: uniqueIndex('reading_contributions_user_key_idx').on(table.userId, table.contributionKey),
  sessionDateIdx: index('reading_contributions_session_date_idx').on(table.userId, table.bookVersionId, table.sessionId, table.date, table.hour),
  bookDateIdx: index('reading_contributions_book_date_idx').on(table.userId, table.bookVersionId, table.date, table.hour),
}))

export const readingHourlyStats = sqliteTable('reading_hourly_stats', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  date: text('date').notNull(),
  hour: integer('hour').notNull(),
  factVersion: integer('fact_version').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  sessionCount: integer('session_count').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId, table.date, table.hour] }),
  bookHourIdx: index('reading_hourly_stats_book_hour_idx').on(table.userId, table.bookVersionId, table.hour, table.date),
}))

export const readingRoundStats = sqliteTable('reading_round_stats', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roundId: text('round_id').notNull().references(() => readingRounds.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  factVersion: integer('fact_version').notNull(),
  totalSeconds: integer('total_seconds').notNull(),
  sessionCount: integer('session_count').notNull(),
  coverage: text('coverage', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
  wordCount: integer('word_count'),
  wordState: text('word_state', { enum: ['known', 'partial', 'unknown'] }).notNull(),
}, (table) => ({
  uniqueRound: uniqueIndex('reading_round_stats_user_round_idx').on(table.userId, table.roundId),
  bookRoundIdx: index('reading_round_stats_book_idx').on(table.userId, table.bookVersionId, table.roundId),
}))

export const readingBookStats = sqliteTable('reading_book_stats', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
  factVersion: integer('fact_version').notNull(),
  algorithmVersion: integer('algorithm_version').notNull(),
  contentRevisionId: text('content_revision_id'),
  contentWordCount: integer('content_word_count'),
  totalSeconds: integer('total_seconds').notNull(),
  sessionCount: integer('session_count').notNull(),
  readingDays: integer('reading_days').notNull(),
  totalWordUnits: integer('total_word_units'),
  knownWordUnits: integer('known_word_units').notNull().default(0),
  knownDurationSeconds: integer('known_duration_seconds').notNull().default(0),
  knownContributionCount: integer('known_contribution_count').notNull().default(0),
  unknownContributionCount: integer('unknown_contribution_count').notNull().default(0),
  wordState: text('word_state', { enum: ['known', 'partial', 'unknown'] }).notNull(),
  coverage: text('coverage', { mode: 'json' }).$type<ReadingCoverageInterval[]>().notNull().default([]),
  earliestDate: text('earliest_date'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId] }),
  userBookIdx: index('reading_book_stats_user_book_idx').on(table.userId, table.bookVersionId, table.factVersion),
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

export const shelves = sqliteTable('shelves', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  librarySortIdx: index('shelves_library_sort_idx').on(table.libraryId, table.sortOrder),
  libraryNameUnique: uniqueIndex('shelves_library_name_unique').on(table.libraryId, table.name),
}))

export const libraryBooks = sqliteTable('library_books', {
  id: text('id').primaryKey(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  categoryId: text('category_id').references(() => libraryCategories.id, { onDelete: 'set null' }),
  shelfId: text('shelf_id').references(() => shelves.id, { onDelete: 'set null' }),
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
  shelfIdx: index('library_books_shelf_idx').on(table.shelfId),
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
  kind: text('kind', { enum: ['book', 'cover', 'content'] }).notNull(),
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
  progressData: text('progress_data', { mode: 'json' }).$type<ProgressFileData | null>(),
  readFraction: real('read_fraction').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.bookVersionId] }),
}))

export const highlights = sqliteTable('highlights', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookVersionId: text('book_version_id').notNull(),
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
  bookVersionId: text('book_version_id').notNull(),
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
  bookVersionId: text('book_version_id'),
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

// Book reviews (书评) v1: work-anchored, one live row per user per work.
// A pure private work anchors to its private library_books row (FK cascade
// with the work). A collected work anchors to its source work as plain-text
// provenance (no FK): the row survives uncollect, fork, version deletes and
// source deletion, and shared reads fall back to private instead of dying.
export const bookReviews = sqliteTable('book_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  privateLibraryBookId: text('private_library_book_id'),
  sourceLibraryId: text('source_library_id'),
  sourceLibraryBookId: text('source_library_book_id'),
  // Integer halves 1–10 (0.5–5 stars); null = unrated, never zero.
  ratingHalves: integer('rating_halves'),
  title: text('title'),
  body: text('body'),
  bodyFormat: text('body_format', { enum: ['plain', 'markdown'] }).notNull().default('markdown'),
  visibility: text('visibility', { enum: ['private', 'shared'] }).notNull().default('private'),
  // Read-time provenance for display only; never decides the review's home.
  readListingId: text('read_listing_id'),
  readBookVersionId: text('read_book_version_id'),
  readRevisionId: text('read_revision_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  editedAt: integer('edited_at'),
}, (table) => ({
  userIdx: index('book_reviews_user_idx').on(table.userId, table.updatedAt),
  sourceIdx: index('book_reviews_source_idx').on(table.sourceLibraryId, table.sourceLibraryBookId, table.visibility),
  sourceUserUnique: uniqueIndex('book_reviews_source_user_unique')
    .on(table.sourceLibraryId, table.sourceLibraryBookId, table.userId)
    .where(sql`${table.sourceLibraryId} IS NOT NULL`),
  privateUnique: uniqueIndex('book_reviews_private_unique')
    .on(table.privateLibraryBookId)
    .where(sql`${table.privateLibraryBookId} IS NOT NULL`),
}))

export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull(),
  eventType: text('event_type').$type<ActivityEventType>().notNull(),
  audience: text('audience').$type<ActivityAudience>().notNull(),
  libraryId: text('library_id').notNull().references(() => libraries.id, { onDelete: 'cascade' }),
  // Identity and target references intentionally do not constrain account or content deletion.
  actorUserId: text('actor_user_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id').notNull(),
  workId: text('work_id'),
  versionId: text('version_id'),
  operationId: text('operation_id'),
  occurredAt: integer('occurred_at').notNull(),
  snapshotWorkTitle: text('snapshot_work_title'),
  snapshotObjectLabel: text('snapshot_object_label'),
  snapshotAuthorId: text('snapshot_author_id'),
}, (table) => ({
  idempotencyUnique: uniqueIndex('activity_events_idempotency_unique').on(table.idempotencyKey),
  libraryPageIdx: index('activity_events_library_page_idx').on(table.libraryId, table.audience, table.occurredAt, table.id),
  actorPageIdx: index('activity_events_actor_page_idx').on(table.actorUserId, table.eventType, table.occurredAt, table.id),
  operationIdx: index('activity_events_operation_idx').on(table.libraryId, table.actorUserId, table.operationId, table.eventType, table.audience),
}))

export const bookReviewComments = sqliteTable('book_review_comments', {
  id: text('id').primaryKey(),
  reviewId: text('review_id').notNull().references(() => bookReviews.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => bookReviewComments.id, { onDelete: 'cascade' }),
  replyToId: text('reply_to_id').references((): AnySQLiteColumn => bookReviewComments.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
  editedAt: integer('edited_at'),
  deletedAt: integer('deleted_at'),
}, (table) => ({ reviewIdx: index('book_review_comments_review_idx').on(table.reviewId, table.createdAt) }))

export const bookReviewLikes = sqliteTable('book_review_likes', {
  reviewId: text('review_id').notNull().references(() => bookReviews.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.reviewId, table.userId] }) }))

export const bookReviewCommentLikes = sqliteTable('book_review_comment_likes', {
  commentId: text('comment_id').notNull().references(() => bookReviewComments.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.commentId, table.userId] }) }))

export const contentUploadDrafts = sqliteTable('content_upload_drafts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  draftId: text('draft_id').notNull(),
  domain: text('domain', { enum: ['idea', 'review'] }).notNull(),
  bookVersionId: text('book_version_id').notNull(),
  intendedTargetId: text('intended_target_id'),
  cancelledAt: integer('cancelled_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ draftUnique: uniqueIndex('content_upload_drafts_unique').on(table.userId, table.draftId) }))

export const contentFiles = sqliteTable('content_files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domain: text('domain', { enum: ['idea', 'review'] }).notNull(),
  kind: text('kind', { enum: ['image', 'attachment'] }).notNull(),
  draftId: text('draft_id').notNull(),
  bookVersionId: text('book_version_id').notNull(),
  intendedTargetId: text('intended_target_id'),
  reviewId: text('review_id').references(() => bookReviews.id, { onDelete: 'cascade' }),
  ideaId: text('idea_id').references(() => ideas.id, { onDelete: 'cascade' }),
  blobKey: text('blob_key').notNull().references(() => blobs.key, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ready: integer('ready', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  draftIdx: index('content_files_draft_idx').on(table.userId, table.draftId),
  reviewIdx: index('content_files_review_idx').on(table.reviewId),
  ideaIdx: index('content_files_idea_idx').on(table.ideaId),
  blobIdx: index('content_files_blob_idx').on(table.blobKey),
}))

export const interactionNotifications = sqliteTable('interaction_notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domain: text('domain', { enum: ['idea', 'review'] }).notNull(),
  event: text('event', { enum: ['comment', 'reply', 'like'] }).notNull(),
  targetId: text('target_id').notNull(),
  interactionId: text('interaction_id').notNull(),
  commentId: text('comment_id'),
  createdAt: integer('created_at').notNull(),
  readAt: integer('read_at'),
}, (table) => ({
  userIdx: index('interaction_notifications_user_idx').on(table.userId, table.createdAt),
  eventUnique: uniqueIndex('interaction_notifications_event_unique').on(table.userId, table.actorId, table.domain, table.event, table.interactionId),
}))

export const interactionReceipts = sqliteTable('interaction_receipts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domain: text('domain', { enum: ['idea', 'review'] }).notNull(),
  requestId: text('request_id').notNull(),
  targetId: text('target_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  resultId: text('result_id').notNull(),
}, (table) => ({
  requestUnique: uniqueIndex('interaction_receipts_request_unique').on(table.userId, table.domain, table.requestId),
}))

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

