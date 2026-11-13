import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sql } from 'drizzle-orm'

export const BOOK_RETIREMENT_TIMESTAMP = 1791700000000
export const LEGACY_IDENTITY_RETIREMENT_TAG = '0040_retire_legacy_identity'
export const IDEA_DISCUSSION_TAG = '0041_idea_discussion'
export const READING_LEDGER_TAG = '0052_reading_ledger'
export const PERSONAL_ARCHIVE_TAG = '0053_personal_archive'
export const CATEGORY_SHELF_SEPARATION_TAG = '0054_category_shelf_separation'
export const READING_PROJECTION_TAG = '0056_reading_projections'
export const CONTENT_EDITOR_TAG = '0057_content_editor'
export const BOOK_STATE_PROGRESS_TAG = '0051_book_state_progress'
// 0058/0059 synthetic timestamps are owned by the personal-source ledger
// reconciler; reading imports take the next slot after that band.
export const READING_IMPORTS_TAG = '0060_reading_imports'
export const INSTANCE_INVITES_TAG = '0061_instance_invites'
export const AI_CHAT_JOBS_TAG = '0062_ai_chat_jobs'
export const ANCHOR_EVIDENCE_TAG = '0063_anchor_evidence'
export const MEMBER_RESOURCE_UPLOAD_TAG = '0064_member_resource_upload_switch'

/** Guarded revert of 0061_instance_invites and 0062_ai_chat_jobs for legacy-fixture
 * tests that reset the migration watermark and re-run the chain from an earlier
 * point. Add every later migration here, otherwise its ledger row is replayed
 * against schema that was never reverted. */
export function revertInstanceAndAiJobsSchema(
  sqlite: { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] }; exec: (sql: string) => void },
) {
  const table = (name: string) => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").all(name).length > 0
  const columns = (name: string) => new Set((sqlite.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((column) => column.name))

  if (table('ai_chat_jobs')) sqlite.exec('DROP TABLE ai_chat_jobs')
  if (table('instance_invite_libraries')) sqlite.exec('DROP TABLE instance_invite_libraries')
  if (table('instance_invites')) sqlite.exec('DROP TABLE instance_invites')
  if (table('instance') && columns('instance').has('registration_mode')) sqlite.exec('ALTER TABLE instance DROP COLUMN registration_mode')
  if (table('instance') && columns('instance').has('allow_user_resource_upload')) sqlite.exec('ALTER TABLE instance DROP COLUMN allow_user_resource_upload')
  // 0063_anchor_evidence also replays after a watermark reset; its columns are
  // nullable annotation metadata on tables some fixtures rebuild by hand.
  for (const anchored of ['highlights', 'bookmarks', 'ideas']) {
    if (table(anchored) && columns(anchored).has('anchor_evidence')) sqlite.exec(`ALTER TABLE ${anchored} DROP COLUMN anchor_evidence`)
  }
}

/** Guarded revert of 0060_reading_imports for legacy-fixture tests that reset
 * the migration watermark and re-run the chain from an earlier point. Every
 * step checks current schema state: some fixtures drop the touched tables
 * before reverting. */
export function revertReadingImportsSchema(
  sqlite: { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] }; exec: (sql: string) => void },
) {
  const table = (name: string) => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").all(name).length > 0
  const index = (name: string) => sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").all(name).length > 0
  const columns = (name: string) => new Set((sqlite.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((column) => column.name))

  if (table('reading_import_bindings')) sqlite.exec('DROP TABLE reading_import_bindings')
  if (table('reading_duration_facts')) sqlite.exec('DROP TABLE reading_duration_facts')
  if (table('reading_archives')) {
    if (index('reading_archives_import_identity_unique')) sqlite.exec('DROP INDEX reading_archives_import_identity_unique')
    const archiveColumns = columns('reading_archives')
    for (const column of ['import_source', 'import_account_key', 'import_book_key', 'cover_url', 'archive_kind', 'meta']) {
      if (archiveColumns.has(column)) sqlite.exec(`ALTER TABLE reading_archives DROP COLUMN ${column}`)
    }
  }
  if (table('highlights') && columns('highlights').has('import_key')) {
    sqlite.exec(`
      DROP INDEX IF EXISTS highlights_user_version_idx;
      DROP INDEX IF EXISTS highlights_user_version_cfi_unique;
      DROP INDEX IF EXISTS highlights_import_key_unique;
      CREATE TABLE highlights_revert (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_version_id TEXT NOT NULL,
        revision_id TEXT,
        cfi_range TEXT NOT NULL,
        cfi_anchor TEXT,
        color TEXT NOT NULL DEFAULT 'yellow',
        style TEXT NOT NULL DEFAULT 'highlight',
        text TEXT NOT NULL DEFAULT '',
        chapter TEXT,
        chapter_href TEXT,
        relocation TEXT NOT NULL DEFAULT 'ok',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      INSERT INTO highlights_revert (id, user_id, book_version_id, revision_id, cfi_range, cfi_anchor, color, style, text, chapter, chapter_href, relocation, created_at, updated_at, deleted_at)
        SELECT id, user_id, book_version_id, revision_id, cfi_range, cfi_anchor, color, style, text, chapter, chapter_href, relocation, created_at, updated_at, deleted_at FROM highlights;
      DROP TABLE highlights;
      ALTER TABLE highlights_revert RENAME TO highlights;
      CREATE INDEX highlights_user_version_idx ON highlights (user_id, book_version_id, deleted_at);
      CREATE UNIQUE INDEX highlights_user_version_cfi_unique ON highlights (user_id, book_version_id, cfi_range);
    `)
  }
  if (table('bookmarks') && columns('bookmarks').has('import_key')) {
    sqlite.exec('DROP INDEX IF EXISTS bookmarks_import_key_unique; ALTER TABLE bookmarks DROP COLUMN import_key; ALTER TABLE bookmarks DROP COLUMN import_hash;')
  }
  if (table('ideas') && columns('ideas').has('import_key')) {
    sqlite.exec('DROP INDEX IF EXISTS ideas_import_key_unique; ALTER TABLE ideas DROP COLUMN import_key; ALTER TABLE ideas DROP COLUMN import_hash;')
    if (columns('ideas').has('import_locator')) sqlite.exec('ALTER TABLE ideas DROP COLUMN import_locator')
    if (columns('ideas').has('import_chapter_index')) sqlite.exec('ALTER TABLE ideas DROP COLUMN import_chapter_index')
  }
  if (table('book_reviews') && columns('book_reviews').has('import_key')) {
    const hasTitle = columns('book_reviews').has('title')
    sqlite.exec(`
      PRAGMA foreign_keys = OFF;
      DROP INDEX IF EXISTS book_reviews_import_key_unique;
      CREATE TABLE book_reviews_revert (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        private_library_book_id TEXT,
        source_library_id TEXT,
        source_library_book_id TEXT,
        rating_halves INTEGER CHECK (rating_halves IS NULL OR (rating_halves >= 1 AND rating_halves <= 10)),
        body TEXT,
        body_format TEXT NOT NULL DEFAULT 'markdown',
        visibility TEXT NOT NULL DEFAULT 'private',
        read_listing_id TEXT,
        read_book_version_id TEXT,
        read_revision_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        edited_at INTEGER,
        ${hasTitle ? 'title TEXT,' : ''}
        CHECK (
          (private_library_book_id IS NOT NULL AND source_library_id IS NULL AND source_library_book_id IS NULL)
          OR (private_library_book_id IS NULL AND source_library_id IS NOT NULL AND source_library_book_id IS NOT NULL)
        ),
        CHECK (rating_halves IS NOT NULL OR (body IS NOT NULL AND body <> ''))
      );
      INSERT INTO book_reviews_revert (id, user_id, private_library_book_id, source_library_id, source_library_book_id, rating_halves, body, body_format, visibility, read_listing_id, read_book_version_id, read_revision_id, created_at, updated_at, edited_at${hasTitle ? ', title' : ''})
        SELECT id, user_id, private_library_book_id, source_library_id, source_library_book_id, rating_halves, body, body_format, visibility, read_listing_id, read_book_version_id, read_revision_id, created_at, updated_at, edited_at${hasTitle ? ', title' : ''} FROM book_reviews;
      DROP TABLE book_reviews;
      ALTER TABLE book_reviews_revert RENAME TO book_reviews;
      CREATE INDEX book_reviews_user_idx ON book_reviews (user_id, updated_at);
      CREATE INDEX book_reviews_source_idx ON book_reviews (source_library_id, source_library_book_id, visibility);
      CREATE UNIQUE INDEX book_reviews_source_user_unique ON book_reviews(source_library_id, source_library_book_id, user_id) WHERE source_library_id IS NOT NULL;
      CREATE UNIQUE INDEX book_reviews_private_unique ON book_reviews(private_library_book_id) WHERE private_library_book_id IS NOT NULL;
      PRAGMA foreign_keys = ON;
    `)
  }
}

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

function readJournalEntries(migrationsFolder: string): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[]
  }
  return journal.entries
}

/** Resolve a journal tag to its `when` timestamp so tests never hardcode one. */
export function migrationTagWhen(migrationsFolder: string, tag: string): number {
  const entry = readJournalEntries(migrationsFolder).find((candidate) => candidate.tag === tag)
  if (!entry) throw new Error(`migration tag not found in journal: ${tag}`)
  return entry.when
}

function stageWithEntries(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
  entries: JournalEntry[],
) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-migration-stage-'))
  try {
    fs.mkdirSync(path.join(scratch, 'meta'))
    const hasReviews = (db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_reviews'`) as unknown[]).length > 0
      || entries.some((entry) => /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?book_reviews["`]?\s*\(/i.test(
        fs.readFileSync(path.join(options.migrationsFolder, `${entry.tag}.sql`), 'utf8'),
      ))
    for (const entry of entries) {
      const source = path.join(options.migrationsFolder, `${entry.tag}.sql`)
      const target = path.join(scratch, `${entry.tag}.sql`)
      if (entry.tag === READING_IMPORTS_TAG && !hasReviews) {
        const contents = fs.readFileSync(source, 'utf8')
        const reviewMigrationStart = contents.indexOf('-- book_reviews gains import_key')
        if (reviewMigrationStart < 0) throw new Error('Consolidated reading import migration is missing its review section')
        const partialMigration = contents.slice(0, reviewMigrationStart)
          .replace(/\s*--> statement-breakpoint\s*$/, '')
          .trimEnd()
        fs.writeFileSync(target, partialMigration)
      } else if (entry.tag === READING_IMPORTS_TAG) {
        const hasReviewTitle = (db.all(sql`PRAGMA table_info(book_reviews)`) as Array<{ name: string }>).some((column) => column.name === 'title')
        const fileColumns = new Set((db.all(sql`PRAGMA table_info(content_files)`) as Array<{ name: string }>).map((column) => column.name))
        let contents = fs.readFileSync(source, 'utf8')
        if (!hasReviewTitle) contents = contents
          .replace(/, edited_at, title\)/g, ', edited_at)')
          .replace(/, edited_at, title FROM book_reviews;/g, ', edited_at FROM book_reviews;')
        if (!fileColumns.has('sort_order')) contents = contents
          .replace(/, "sort_order"/g, '')
          .replace(/"sort_order", /g, '')
        fs.writeFileSync(target, contents)
      } else fs.copyFileSync(source, target)
    }
    fs.writeFileSync(path.join(scratch, 'meta/_journal.json'), JSON.stringify({ entries }))
    migrate(db, { ...options, migrationsFolder: scratch })
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

/** Run every migration whose journal tag matches, in journal order. */
export function migrateWithTagFilter(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
  predicate: (entry: { when: number; tag: string }) => boolean,
) {
  stageWithEntries(db, options, readJournalEntries(options.migrationsFolder).filter(predicate))
}

/** Keep the async data/file bridge outside Drizzle's synchronous SQL transaction. */
export function migrateBeforeBookRetirement(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
) {
  migrateWithTagFilter(db, options, (entry) => entry.when < BOOK_RETIREMENT_TIMESTAMP)
}

/**
 * Pre-retirement base plus selected later migrations (e.g. idea discussion
 * tables for annotation tests), resolved by journal tag instead of filename.
 */
export function migrateBeforeBookRetirementIncluding(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
  includeTags: string[],
) {
  // Older partial fixtures lack book_reviews, so stage only the archive/annotation portion there.
  // MEMBER_RESOURCE_UPLOAD_TAG keeps the drizzle `instance` shape and its
  // settings queries consistent across service-test fixtures.
  const include = new Set([...includeTags, BOOK_STATE_PROGRESS_TAG, READING_LEDGER_TAG, READING_PROJECTION_TAG, CONTENT_EDITOR_TAG, READING_IMPORTS_TAG, INSTANCE_INVITES_TAG, AI_CHAT_JOBS_TAG, ANCHOR_EVIDENCE_TAG, MEMBER_RESOURCE_UPLOAD_TAG])
  migrateWithTagFilter(
    db,
    options,
    (entry) => entry.when < BOOK_RETIREMENT_TIMESTAMP || include.has(entry.tag),
  )
  // Partial legacy fixtures omit optional discussion tables required by 0053,
  // but current service projections still need the archive metadata columns.
  if (!include.has('0053_personal_archive')) {
    db.run(sql`ALTER TABLE reading_archives ADD COLUMN format TEXT`)
    db.run(sql`ALTER TABLE reading_archives ADD COLUMN cover_key TEXT`)
  }
  repairHybridShelfSchema(db)
  ensureTestActivityEvents(db)
}

/**
 * Partial service-test databases retain legacy books/shelves while exercising
 * current library queries. Keep the old shelf rows in place and add the
 * current nullable ownership/visibility columns plus the library-book FK.
 */
function repairHybridShelfSchema(db: Parameters<typeof migrate>[0]) {
  const shelfColumns = new Set((db.all(sql`PRAGMA table_info("shelves")`) as Array<{ name: string }>).map((column) => column.name))
  const libraryBookColumns = new Set((db.all(sql`PRAGMA table_info("library_books")`) as Array<{ name: string }>).map((column) => column.name))
  if (!shelfColumns.size || !libraryBookColumns.size) return
  if (!shelfColumns.has('library_id')) db.run(sql`ALTER TABLE shelves ADD COLUMN library_id TEXT REFERENCES libraries(id) ON DELETE CASCADE`)
  if (!shelfColumns.has('pinned')) db.run(sql`ALTER TABLE shelves ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`)
  if (!shelfColumns.has('hidden')) db.run(sql`ALTER TABLE shelves ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`)
  if (!shelfColumns.has('updated_at')) db.run(sql`ALTER TABLE shelves ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`)
  if (!libraryBookColumns.has('shelf_id')) db.run(sql`ALTER TABLE library_books ADD COLUMN shelf_id TEXT REFERENCES shelves(id) ON DELETE SET NULL`)
  db.run(sql`CREATE INDEX IF NOT EXISTS shelves_library_sort_idx ON shelves(library_id, sort_order)`)
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS shelves_library_name_unique ON shelves(library_id, name)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS library_books_shelf_idx ON library_books(shelf_id)`)
}

/**
 * Unit-test base for suites that touch the storage backend tables
 * (`instance` backend columns, `blobs` tiers, `storage_connections`,
 * `storage_transfer_tasks`). The storage migrations sit after the
 * retirement chain in journal order, so they cannot join the time-based
 * base without breaking the drizzle `MAX(created_at)` watermark — they are
 * pulled in explicitly by tag instead. Suites that drive the production
 * migration chain itself (retirement/upgrade tests) must keep the pure
 * time-based base.
 */
export function migrateTestBaseWithStorage(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
) {
  return migrateBeforeBookRetirementIncluding(db, options, [
    '0042_storage_connections',
    '0043_storage_backend',
    '0044_storage_s3',
  ])
}

/**
 * Hybrid service fixtures stop before newer feature migrations, then apply
 * selected legacy tables by hand. Keep the activity writer table available
 * without advancing Drizzle's migration watermark or running historical
 * backfills against this intentionally mixed schema.
 */
function ensureTestActivityEvents(db: Parameters<typeof migrate>[0]) {
  db.run(sql.raw(`CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    audience TEXT NOT NULL,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    actor_user_id TEXT,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    work_id TEXT,
    version_id TEXT,
    operation_id TEXT,
    occurred_at INTEGER NOT NULL,
    snapshot_work_title TEXT,
    snapshot_object_label TEXT,
    snapshot_author_id TEXT
  )`))
  db.run(sql.raw('CREATE UNIQUE INDEX IF NOT EXISTS activity_events_idempotency_unique ON activity_events(idempotency_key)'))
  db.run(sql.raw('CREATE INDEX IF NOT EXISTS activity_events_library_page_idx ON activity_events(library_id, audience, occurred_at, id)'))
  db.run(sql.raw('CREATE INDEX IF NOT EXISTS activity_events_actor_page_idx ON activity_events(actor_user_id, event_type, occurred_at, id)'))
  db.run(sql.raw('CREATE INDEX IF NOT EXISTS activity_events_operation_idx ON activity_events(library_id, actor_user_id, operation_id, event_type, audience)'))
}
