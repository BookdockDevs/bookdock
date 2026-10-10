import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export const BOOK_RETIREMENT_TIMESTAMP = 1791700000000
export const LEGACY_IDENTITY_RETIREMENT_TAG = '0040_retire_legacy_identity'
export const IDEA_DISCUSSION_TAG = '0041_idea_discussion'

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
  const include = new Set(includeTags)
  migrateWithTagFilter(
    db,
    options,
    (entry) => entry.when < BOOK_RETIREMENT_TIMESTAMP || include.has(entry.tag),
  )
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
  ])
}
