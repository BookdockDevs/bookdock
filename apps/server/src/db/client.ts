import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
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

export function runMigrations() {
  const db = getDb()
  // Resolved relative to this module so it works from src/ (dev) and the
  // bundled dist/ (production); the build copies migrations next to the bundle.
  migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) })

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
}
