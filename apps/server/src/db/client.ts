import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from './schema'
import { config } from '../config'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db
  const sqlite = new Database(config.dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  _db = drizzle(sqlite, { schema })
  return _db
}

export function repairLegacyTextReplacementSchema(db: ReturnType<typeof drizzle<typeof schema>>) {
  const tables = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\'')) as Array<{ name: string }>).map(({ name }) => name),
  )

  if (tables.has('text_transform_overrides') && !tables.has('text_replacement_overrides')) {
    db.run(sql.raw('ALTER TABLE `text_transform_overrides` RENAME TO `text_replacement_overrides`'))
  }
  if (tables.has('text_transforms') && !tables.has('text_replacements')) {
    db.run(sql.raw('ALTER TABLE `text_transforms` RENAME TO `text_replacements`'))
  }

  const replacementOverrideColumns = db.all(sql.raw('PRAGMA table_info(text_replacement_overrides)')) as Array<{ name: string }>
  const hasTransformId = replacementOverrideColumns.some(({ name }) => name === 'transform_id')
  const hasReplacementId = replacementOverrideColumns.some(({ name }) => name === 'replacement_id')
  if (hasTransformId && !hasReplacementId) {
    db.run(sql.raw('ALTER TABLE `text_replacement_overrides` RENAME COLUMN `transform_id` TO `replacement_id`'))
  }

  const indexes = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'index\'')) as Array<{ name: string }>).map(({ name }) => name),
  )
  if (tables.has('text_transform_overrides') || tables.has('text_replacement_overrides')) {
    if (indexes.has('text_transform_overrides_book_transform_unique')) {
      db.run(sql.raw('DROP INDEX `text_transform_overrides_book_transform_unique`'))
    }
    if (indexes.has('text_transform_overrides_user_book_idx')) {
      db.run(sql.raw('DROP INDEX `text_transform_overrides_user_book_idx`'))
    }
    db.run(sql.raw('CREATE UNIQUE INDEX IF NOT EXISTS `text_replacement_overrides_book_replacement_unique` ON `text_replacement_overrides` (`book_id`, `replacement_id`)'))
    db.run(sql.raw('CREATE INDEX IF NOT EXISTS `text_replacement_overrides_user_book_idx` ON `text_replacement_overrides` (`user_id`, `book_id`)'))
  }
  if (tables.has('text_transforms') || tables.has('text_replacements')) {
    if (indexes.has('text_transforms_user_book_idx')) {
      db.run(sql.raw('DROP INDEX `text_transforms_user_book_idx`'))
    }
    db.run(sql.raw('CREATE INDEX IF NOT EXISTS `text_replacements_user_book_idx` ON `text_replacements` (`user_id`, `book_id`)'))
  }

  if (tables.has('text_transforms') || tables.has('text_replacements')) {
    const replacementColumns = db.all(sql.raw('PRAGMA table_info(text_replacements)')) as Array<{ name: string }>
    if (replacementColumns.some(({ name }) => name === 'case_sensitive')) {
      db.run(sql.raw('ALTER TABLE `text_replacements` DROP COLUMN `case_sensitive`'))
    }
    if (!replacementColumns.some(({ name }) => name === 'apply_to')) {
      db.run(sql.raw('ALTER TABLE `text_replacements` ADD COLUMN `apply_to` TEXT NOT NULL DEFAULT \'content\''))
    }
  }
}

export function reconcileConsolidatedMigrationLedger(
  db: ReturnType<typeof drizzle<typeof schema>>,
  migrationsFolder: string,
) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const latestMigration = migrations.at(-1)
  const latestRecorded = db.get<{ createdAt: number }>(sql.raw('SELECT created_at AS "createdAt" FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1'))
  if (!latestMigration || !latestRecorded || Number(latestRecorded.createdAt) <= latestMigration.folderMillis) return

  const tables = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\'')) as Array<{ name: string }>).map(({ name }) => name),
  )
  const requiredTables = ['users', 'books', 'tags', 'toc_rules', 'text_replacements', 'text_replacement_overrides', 'legado_access_keys']
  const missingTables = requiredTables.filter((table) => !tables.has(table))
  if (missingTables.length > 0) {
    throw new Error(`Cannot reconcile migration ledger; missing tables: ${missingTables.join(', ')}`)
  }

  // Downgrade guard: the ledger holds migrations this code never heard of
  // (e.g. an older release booted against a newer database). Rewriting the
  // ledger down to the known set would orphan those records and break the
  // next boot with re-runs against existing tables — refuse loudly instead.
  // Abandoned migrations (same count, e.g. a deleted forward file) still
  // reconcile as before.
  const recordedHashes = (db.all(sql.raw('SELECT hash AS "hash" FROM "__drizzle_migrations"')) as Array<{ hash: string }>)
    .map((row) => row.hash)
  const journalHashes = new Set(migrations.map((migration) => migration.hash))
  if (recordedHashes.length > migrations.length && recordedHashes.some((hash) => !journalHashes.has(hash))) {
    throw new Error(
      `Refusing to reconcile migration ledger: database ran ${recordedHashes.length} migrations but this code knows ${migrations.length}. Boot the newer release instead; downgrade boots are not supported.`,
    )
  }

  db.transaction((tx) => {
    tx.run(sql.raw('DELETE FROM "__drizzle_migrations"'))
    for (const migration of migrations) {
      tx.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`)
    }
  })
}

export interface RunMigrationsHooks {
  /**
   * Runs after structural repairs and before the book-id retarget. The
   * production server uses this for the Phase 2 data backfill: versions must
   * exist before book-bound rows are retargeted at them, otherwise the
   * retarget refuses to boot on legacy databases. Callers without legacy data
   * (tests, manual drill runner with its own sequencing) omit it.
   */
  beforeRetarget?: () => unknown
}

export async function runMigrations(hooks?: RunMigrationsHooks) {
  const db = getDb()
  // Resolved relative to this module so it works from src/ (dev) and the
  // bundled dist/ (production); the build copies migrations next to the bundle.
  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
  migrate(db, { migrationsFolder })
  repairLegacyTextReplacementSchema(db)

  const tagColumns = db.all(sql.raw('PRAGMA table_info(tags)')) as Array<{ name: string }>
  // The private baseline was rebased after some local databases had already
  // recorded a later migration timestamp. Drizzle can then skip a forward
  // migration even though the column is absent from the physical table.
  if (tagColumns.length > 0 && !tagColumns.some((column) => column.name === 'sort_order')) {
    db.run(sql.raw('ALTER TABLE "tags" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0'))
  }

  const tocRuleColumns = db.all(sql.raw('PRAGMA table_info(toc_rules)')) as Array<{ name: string }>
  if (tocRuleColumns.length > 0 && !tocRuleColumns.some((column) => column.name === 'seed_key')) {
    db.run(sql.raw('ALTER TABLE "toc_rules" ADD COLUMN "seed_key" TEXT'))
  }

  const tocRuleIndexes = db.all(sql.raw('PRAGMA index_list(toc_rules)')) as Array<{ name: string }>
  if (tocRuleColumns.length > 0 && !tocRuleIndexes.some((index) => index.name === 'toc_rules_user_seed_key_unique')) {
    db.run(sql.raw('CREATE UNIQUE INDEX "toc_rules_user_seed_key_unique" ON "toc_rules" ("user_id", "seed_key")'))
  }

  const accessKeyColumns = db.all(sql.raw('PRAGMA table_info(legado_access_keys)')) as Array<{ name: string }>
  if (accessKeyColumns.length > 0 && !accessKeyColumns.some((column) => column.name === 'encrypted_token')) {
    db.run(sql.raw('ALTER TABLE "legado_access_keys" ADD COLUMN "encrypted_token" TEXT'))
  }

  repairLibraryBooksDeletedAt(db)
  repairBookmarkFields(db)
  await hooks?.beforeRetarget?.()
  retargetBookIdReferences(db)

  reconcileConsolidatedMigrationLedger(db, migrationsFolder)
}

/**
 * Phase 3 book-id retarget: book-bound rows reference versions, not legacy
 * books rows, so version-native books accept reading data, AI history and
 * replacement rules. SQLite cannot rewrite an FK target in place, and
 * rename-swap is unusable (RENAME rewrites every other table's FK clauses to
 * follow the old name). Instead each table is rebuilt under a temp name with
 * FK checks off, then swapped into place with plain DROP/CREATE — no renames
 * anywhere, so no clause ever points at a transient name.
 *
 * Runs at startup like the other repairs (idempotent per table) and refuses
 * loudly when rows reference books without versions: that database has not
 * run the Phase 2 data migration, and silently dropping history is worse
 * than refusing to boot. Fresh and fully-migrated databases pass through.
 */
export function retargetBookIdReferences(db: ReturnType<typeof drizzle<typeof schema>>) {
  const tables = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\'')) as Array<{ name: string }>).map(({ name }) => name),
  )
  if (!tables.has('book_versions')) return
  const specs: Array<{ table: string; columns: string; create: string; indexes: string[] }> = [
    {
      table: 'reading_records',
      columns: '`id`, `user_id`, `book_id`, `date`, `duration_seconds`, `book_version_id`',
      create: `CREATE TABLE \`reading_records_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`date\` text NOT NULL,
	\`duration_seconds\` integer NOT NULL DEFAULT 0,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE UNIQUE INDEX `reading_records_user_book_date_idx` ON `reading_records` (`user_id`, `book_id`, `date`)',
        'CREATE INDEX `reading_records_user_date_idx` ON `reading_records` (`user_id`, `date`)',
        'CREATE INDEX `reading_records_book_version_idx` ON `reading_records` (`book_version_id`)',
      ],
    },
    {
      table: 'reading_sessions',
      columns: '`id`, `user_id`, `book_id`, `date`, `started_at`, `duration_seconds`, `ended_at`, `start_cfi`, `end_cfi`, `start_fraction`, `end_fraction`, `start_chapter_index`, `end_chapter_index`, `book_version_id`',
      create: `CREATE TABLE \`reading_sessions_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`date\` text NOT NULL,
	\`started_at\` integer,
	\`duration_seconds\` integer NOT NULL DEFAULT 0,
	\`ended_at\` integer,
	\`start_cfi\` text,
	\`end_cfi\` text,
	\`start_fraction\` real,
	\`end_fraction\` real,
	\`start_chapter_index\` integer,
	\`end_chapter_index\` integer,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE INDEX `reading_sessions_user_date_idx` ON `reading_sessions` (`user_id`, `date`)',
        'CREATE INDEX `reading_sessions_book_version_idx` ON `reading_sessions` (`book_version_id`)',
      ],
    },
    {
      table: 'ai_threads',
      columns: '`id`, `user_id`, `book_id`, `title`, `created_at`, `updated_at`, `settings`, `book_version_id`',
      create: `CREATE TABLE \`ai_threads_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`title\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`settings\` text,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE INDEX `ai_threads_user_book_updated_idx` ON `ai_threads` (`user_id`, `book_id`, `updated_at`)',
        'CREATE INDEX `ai_threads_book_version_idx` ON `ai_threads` (`book_version_id`)',
      ],
    },
    {
      table: 'ai_book_indexes',
      columns: '`id`, `user_id`, `book_id`, `source_version`, `status`, `chunk_count`, `error`, `created_at`, `updated_at`, `embedding_status`, `embedding_model`, `embedding_dim`, `progress`, `embedding_provider`, `book_version_id`',
      create: `CREATE TABLE \`ai_book_indexes_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`source_version\` text NOT NULL,
	\`status\` text NOT NULL,
	\`chunk_count\` integer DEFAULT 0 NOT NULL,
	\`error\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`embedding_status\` text DEFAULT 'unavailable' NOT NULL,
	\`embedding_model\` text,
	\`embedding_dim\` integer,
	\`progress\` integer DEFAULT 0 NOT NULL,
	\`embedding_provider\` text,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE UNIQUE INDEX `ai_book_indexes_user_book_unique` ON `ai_book_indexes` (`user_id`, `book_id`)',
        'CREATE INDEX `ai_book_indexes_user_status_updated_idx` ON `ai_book_indexes` (`user_id`, `status`, `updated_at`)',
        'CREATE INDEX `ai_book_indexes_book_version_idx` ON `ai_book_indexes` (`book_version_id`)',
      ],
    },
    {
      table: 'ai_chunks',
      columns: '`id`, `user_id`, `index_id`, `book_id`, `chapter_index`, `chapter_id`, `chapter_title`, `start_offset`, `end_offset`, `text`, `created_at`, `book_version_id`',
      create: `CREATE TABLE \`ai_chunks_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`index_id\` text NOT NULL REFERENCES \`ai_book_indexes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`chapter_index\` integer NOT NULL,
	\`chapter_id\` text NOT NULL,
	\`chapter_title\` text NOT NULL,
	\`start_offset\` integer NOT NULL,
	\`end_offset\` integer NOT NULL,
	\`text\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE INDEX `ai_chunks_user_book_chapter_idx` ON `ai_chunks` (`user_id`, `book_id`, `chapter_index`, `start_offset`)',
        'CREATE INDEX `ai_chunks_index_id_idx` ON `ai_chunks` (`index_id`)',
        'CREATE INDEX `ai_chunks_book_version_idx` ON `ai_chunks` (`book_version_id`)',
        'CREATE TRIGGER `ai_chunks_fts_insert` AFTER INSERT ON `ai_chunks` BEGIN\n\tINSERT INTO `ai_chunks_fts` (`chunk_id`, `user_id`, `book_id`, `chapter_index`, `chapter_title`, `text`)\n\tVALUES (new.`id`, new.`user_id`, new.`book_id`, new.`chapter_index`, new.`chapter_title`, new.`text`);\nEND',
        'CREATE TRIGGER `ai_chunks_fts_update` AFTER UPDATE ON `ai_chunks` BEGIN\n\tDELETE FROM `ai_chunks_fts` WHERE `chunk_id` = old.`id`;\n\tINSERT INTO `ai_chunks_fts` (`chunk_id`, `user_id`, `book_id`, `chapter_index`, `chapter_title`, `text`)\n\tVALUES (new.`id`, new.`user_id`, new.`book_id`, new.`chapter_index`, new.`chapter_title`, new.`text`);\nEND',
        'CREATE TRIGGER `ai_chunks_fts_delete` AFTER DELETE ON `ai_chunks` BEGIN\n\tDELETE FROM `ai_chunks_fts` WHERE `chunk_id` = old.`id`;\nEND',
      ],
    },
    {
      table: 'ai_chunk_embeddings',
      columns: '`id`, `user_id`, `index_id`, `chunk_id`, `book_id`, `model`, `dimension`, `vector`, `created_at`, `book_version_id`',
      create: `CREATE TABLE \`ai_chunk_embeddings_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`index_id\` text NOT NULL REFERENCES \`ai_book_indexes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`chunk_id\` text NOT NULL REFERENCES \`ai_chunks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`model\` text NOT NULL,
	\`dimension\` integer NOT NULL,
	\`vector\` blob NOT NULL,
	\`created_at\` integer NOT NULL,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE UNIQUE INDEX `ai_chunk_embeddings_index_chunk_unique` ON `ai_chunk_embeddings` (`index_id`, `chunk_id`)',
        'CREATE INDEX `ai_chunk_embeddings_user_book_idx` ON `ai_chunk_embeddings` (`user_id`, `book_id`, `index_id`)',
        'CREATE INDEX `ai_chunk_embeddings_book_version_idx` ON `ai_chunk_embeddings` (`book_version_id`)',
      ],
    },
    {
      table: 'text_replacements',
      columns: '`id`, `user_id`, `book_id`, `match_type`, `pattern`, `replacement`, `is_regex`, `enabled`, `name`, `group_name`, `spine_href`, `text_offset`, `original_text`, `created_at`, `updated_at`, `apply_to`, `book_version_id`',
      create: `CREATE TABLE \`text_replacements_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`match_type\` text NOT NULL DEFAULT 'pattern',
	\`pattern\` text,
	\`replacement\` text,
	\`is_regex\` integer NOT NULL DEFAULT 0,
	\`enabled\` integer NOT NULL DEFAULT 1,
	\`name\` text,
	\`group_name\` text,
	\`spine_href\` text,
	\`text_offset\` integer,
	\`original_text\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`apply_to\` text NOT NULL DEFAULT 'content',
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE INDEX `text_replacements_user_book_idx` ON `text_replacements` (`user_id`, `book_id`)',
        'CREATE INDEX `text_replacements_book_version_idx` ON `text_replacements` (`book_version_id`)',
      ],
    },
    {
      table: 'text_replacement_overrides',
      columns: '`id`, `user_id`, `book_id`, `replacement_id`, `enabled`, `created_at`, `updated_at`, `book_version_id`',
      create: `CREATE TABLE \`text_replacement_overrides_new\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`book_id\` text NOT NULL REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`replacement_id\` text NOT NULL REFERENCES \`text_replacements\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	\`enabled\` integer NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`book_version_id\` text REFERENCES \`book_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`,
      indexes: [
        'CREATE UNIQUE INDEX `text_replacement_overrides_book_replacement_unique` ON `text_replacement_overrides` (`book_id`, `replacement_id`)',
        'CREATE INDEX `text_replacement_overrides_user_book_idx` ON `text_replacement_overrides` (`user_id`, `book_id`)',
        'CREATE INDEX `text_replacement_overrides_book_version_idx` ON `text_replacement_overrides` (`book_version_id`)',
      ],
    },
  ]
  db.run(sql.raw('PRAGMA foreign_keys=OFF'))
  try {
    for (const spec of specs) {
      if (!tables.has(spec.table)) continue
      const refs = db.all(sql.raw(`PRAGMA foreign_key_list("${spec.table}")`)) as Array<{ from: string; table: string }>
      if (refs.some((ref) => ref.from === 'book_id' && ref.table === 'book_versions')) continue
      const orphans = db.get<{ count: number }>(sql.raw(
        `SELECT COUNT(*) AS "count" FROM "${spec.table}" WHERE "book_id" IS NOT NULL AND "book_id" NOT IN (SELECT "id" FROM "book_versions")`,
      ))
      if ((orphans?.count ?? 0) > 0) {
        throw new Error(
          `Cannot retarget ${spec.table}: ${orphans?.count} rows reference books without versions. Run the Phase 2 data migration first.`,
        )
      }
      db.run(sql.raw(spec.create))
      db.run(sql.raw(`INSERT INTO "${spec.table}_new" (${spec.columns}) SELECT ${spec.columns} FROM "${spec.table}"`))
      db.run(sql.raw(`DROP TABLE "${spec.table}"`))
      db.run(sql.raw(`ALTER TABLE "${spec.table}_new" RENAME TO "${spec.table}"`))
      for (const index of spec.indexes) db.run(sql.raw(index))
    }
  } finally {
    db.run(sql.raw('PRAGMA foreign_keys=ON'))
  }
  const violations = db.all(sql.raw('PRAGMA foreign_key_check')) as Array<unknown>
  if (violations.length > 0) {
    throw new Error(`Book-id retarget left ${violations.length} foreign-key violations; restore from backup.`)
  }
}

/**
 * library_books.deleted_at was added to the 0008 foundation file after that
 * migration had already applied to a live database, so the ledger records
 * 0008 as done while the column is physically absent. Forward-repair it
 * here (same pattern as the tags/legado guards above) instead of rewriting
 * migration history. Fresh databases already carry the column via 0008.
 */
export function repairLibraryBooksDeletedAt(db: ReturnType<typeof drizzle<typeof schema>>) {
  const columns = db.all(sql.raw('PRAGMA table_info(library_books)')) as Array<{ name: string }>
  if (columns.length > 0 && !columns.some((column) => column.name === 'deleted_at')) {
    db.run(sql.raw('ALTER TABLE "library_books" ADD COLUMN "deleted_at" INTEGER'))
  }
}

/**
 * Bookmarks migrated while the annotation split dropped their text/href
 * (title written as null, no chapter_href column yet) read back as bare
 * "书签" cards. The frozen legacy annotations table still holds both, so
 * backfill them: title unconditionally where a legacy row matches (empty
 * text displays identically), href only where the legacy row actually has
 * one. Rows created after the migration have no legacy counterpart and are
 * never touched. Idempotent.
 */
export function repairBookmarkFields(db: ReturnType<typeof drizzle<typeof schema>>) {
  const tables = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\'')) as Array<{ name: string }>).map(({ name }) => name),
  )
  if (!tables.has('bookmarks') || !tables.has('annotations')) return
  const columns = db.all(sql.raw('PRAGMA table_info(bookmarks)')) as Array<{ name: string }>
  const hasHref = columns.some((column) => column.name === 'chapter_href')
  db.run(sql.raw(`UPDATE "bookmarks" SET "title" = (
    SELECT "text" FROM "annotations" WHERE "annotations"."id" = "bookmarks"."id"
  ) WHERE "title" IS NULL AND EXISTS (
    SELECT 1 FROM "annotations" WHERE "annotations"."id" = "bookmarks"."id" AND "annotations"."type" = 'bookmark'
  )`))
  if (hasHref) {
    db.run(sql.raw(`UPDATE "bookmarks" SET "chapter_href" = (
      SELECT "chapter_href" FROM "annotations" WHERE "annotations"."id" = "bookmarks"."id"
    ) WHERE "chapter_href" IS NULL AND EXISTS (
      SELECT 1 FROM "annotations" WHERE "annotations"."id" = "bookmarks"."id"
        AND "annotations"."type" = 'bookmark' AND "annotations"."chapter_href" IS NOT NULL
    )`))
  }
}
