import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runDatabaseMigrations } from './client'
import { repairReadingLedgerSchema } from './reading-ledger-repair'
import * as schema from './schema'

describe('reading ledger schema repair', () => {
  it('restores rotated daily columns and their residual baseline without changing sessions', async () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    try {
      await runDatabaseMigrations(db)
      sqlite.exec(`
        INSERT INTO users(id,username,created_at) VALUES ('u','reader',1);
        INSERT INTO reading_archives(user_id,book_version_id,title,created_at,updated_at) VALUES ('u','v','Title',1,2);
        INSERT INTO reading_records(id,user_id,book_id,book_version_id,date,duration_seconds)
          VALUES ('broken','u','v','2026-10-01','180','v'),('good','u','v','v','2026-10-02',30);
        INSERT INTO reading_sessions(id,user_id,book_id,date,duration_seconds) VALUES ('s','u','v','2026-10-01',120);
      `)
      const sessions = sqlite.prepare('SELECT * FROM reading_sessions').all()
      await runDatabaseMigrations(db)
      expect(db.select().from(schema.readingRecords).all()).toEqual([
        { id: 'broken', userId: 'u', bookId: 'v', bookVersionId: 'v', date: '2026-10-01', durationSeconds: 180, factVersion: 0, wordUnits: null, wordState: 'unknown', progressDelta: 0, coverage: [] },
        { id: 'good', userId: 'u', bookId: 'v', bookVersionId: 'v', date: '2026-10-02', durationSeconds: 30, factVersion: 0, wordUnits: null, wordState: 'unknown', progressDelta: 0, coverage: [] },
      ])
      expect(db.select().from(schema.readingArchives).all()[0].legacyDaily).toEqual([{ date: '2026-10-01', durationSeconds: 60 }])
      const repaired = sqlite.prepare('SELECT * FROM reading_records').all()
      repairReadingLedgerSchema(db)
      expect(sqlite.prepare('SELECT * FROM reading_records').all()).toEqual(repaired)
      expect(sqlite.prepare('SELECT * FROM reading_sessions').all()).toEqual(sessions)
      expect(db.select().from(schema.readingArchives).all()[0].legacyDaily).toEqual([{ date: '2026-10-01', durationSeconds: 60 }])
    } finally { sqlite.close() }
  }, 20_000)

  it('repairs an already recorded early ledger without changing reading facts', async () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    try {
      await runDatabaseMigrations(db)
      sqlite.exec(`
        INSERT INTO users(id,username,created_at) VALUES ('u','reader',1);
        INSERT INTO reading_archives(user_id,book_version_id,title,legacy_intervals,legacy_daily,created_at,updated_at)
          VALUES ('u','v','Stored title','[[0.1,0.5]]','[{"date":"2026-10-01","durationSeconds":90}]',1,2);
        INSERT INTO reading_sessions(id,user_id,book_id,date,duration_seconds,request_id,body_hash)
          VALUES ('s','u','v','2026-10-01',120,'request','original-hash');
        DROP TABLE reading_write_receipts;
        ALTER TABLE reading_archives DROP COLUMN legacy_revision_id;
      `)
      const sessions = sqlite.prepare('SELECT * FROM reading_sessions').all()
      const archives = sqlite.prepare('SELECT * FROM reading_archives').all()
      const migrations = sqlite.prepare('SELECT * FROM __drizzle_migrations').all()
      expect(() => db.select().from(schema.readingArchives).all()).toThrow(/legacy_revision_id/)
      await runDatabaseMigrations(db)
      expect(db.select().from(schema.readingArchives).all()[0].legacyRevisionId).toBeNull()
      expect(sqlite.prepare('SELECT * FROM reading_sessions').all()).toEqual(sessions)
      expect(sqlite.prepare('SELECT * FROM reading_archives').all()).toEqual(archives.map((row) => ({ ...(row as object), legacy_revision_id: null })))
      expect(sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(migrations)
      expect(db.select().from(schema.readingWriteReceipts).all()).toEqual([
        { userId: 'u', requestId: 'request', bookVersionId: 'v', bodyHash: 'original-hash', sessionId: 's', status: 'accepted' },
      ])
      sqlite.exec("UPDATE reading_write_receipts SET status = 'deleted', session_id = NULL")
      repairReadingLedgerSchema(db)
      expect(db.select().from(schema.readingWriteReceipts).all()[0].status).toBe('deleted')
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally { sqlite.close() }
  }, 20_000)

  it('leaves a fully migrated schema unchanged on repeated repairs', async () => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    try {
      await runDatabaseMigrations(db)
      const structure = sqlite.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()
      repairReadingLedgerSchema(db)
      repairReadingLedgerSchema(db)
      expect(sqlite.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(structure)
    } finally { sqlite.close() }
  }, 20_000)

  it('does nothing before the ledger migration exists', () => {
    const sqlite = new Database(':memory:')
    try {
      repairReadingLedgerSchema(drizzle(sqlite, { schema }))
      expect(sqlite.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
    } finally { sqlite.close() }
  })
})
