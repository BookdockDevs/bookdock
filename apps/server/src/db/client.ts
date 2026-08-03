import Database from 'better-sqlite3'
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
}
