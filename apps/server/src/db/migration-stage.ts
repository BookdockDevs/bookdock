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
export const BOOK_STATE_PROGRESS_TAG = '0051_book_state_progress'

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
    for (const entry of entries) {
      fs.copyFileSync(path.join(options.migrationsFolder, `${entry.tag}.sql`), path.join(scratch, `${entry.tag}.sql`))
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
  const include = new Set([...includeTags, BOOK_STATE_PROGRESS_TAG, READING_LEDGER_TAG, READING_PROJECTION_TAG])
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
