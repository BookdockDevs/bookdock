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
  const requiredTables = ['users', 'books', 'tags', 'toc_rules', 'text_replacements', 'text_replacement_overrides']
  const missingTables = requiredTables.filter((table) => !tables.has(table))
  if (missingTables.length > 0) {
    throw new Error(`Cannot reconcile migration ledger; missing tables: ${missingTables.join(', ')}`)
  }

  db.transaction((tx) => {
    tx.run(sql.raw('DELETE FROM "__drizzle_migrations"'))
    for (const migration of migrations) {
      tx.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`)
    }
  })
}

export function runMigrations() {
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

  reconcileConsolidatedMigrationLedger(db, migrationsFolder)
}
