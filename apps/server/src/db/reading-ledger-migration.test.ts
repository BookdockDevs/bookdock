import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

import { retargetBookIdReferences } from './client'
import { migrateBeforeBookRetirement, migrateWithTagFilter, migrationTagWhen, READING_LEDGER_TAG } from './migration-stage'
import * as schema from './schema'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

function databaseBeforeLedger() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirement(db, { migrationsFolder })
  retargetBookIdReferences(db)
  const ledgerWhen = migrationTagWhen(migrationsFolder, READING_LEDGER_TAG)
  migrateWithTagFilter(db, { migrationsFolder }, (entry) => entry.when < ledgerWhen)
  return { sqlite, db }
}

describe('reading ledger migration', () => {
  it('creates the ledger on a fresh database and tolerates the next startup retarget', () => {
    const { sqlite, db } = databaseBeforeLedger()
    try {
      migrate(db, { migrationsFolder })
      retargetBookIdReferences(db)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      expect(sqlite.pragma('table_info(reading_sessions)')).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'request_id' }), expect.objectContaining({ name: 'fragments' }),
      ]))
      expect(sqlite.pragma('foreign_key_list(reading_sessions)')).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'book_versions' }),
      ]))
    } finally { sqlite.close() }
  })

  it('preserves old facts, private snapshots and residual daily time without inventing provenance', () => {
    const { sqlite, db } = databaseBeforeLedger()
    try {
      sqlite.exec(`
        INSERT INTO users(id,username,created_at) VALUES ('u1','first',1),('u2','second',1);
        INSERT INTO book_versions(id,format,size,created_at,updated_at) VALUES ('v1','epub',1,1,1),('v2','epub',1,1,1);
        INSERT INTO libraries(id,user_id,type,name,created_at,updated_at) VALUES ('l1','u1','private','Private',1,1);
        INSERT INTO library_books(id,library_id,user_id,title,author,created_at,updated_at) VALUES ('b1','l1','u1','My title','My author',1,1);
        INSERT INTO library_book_versions(id,library_id,library_book_id,book_version_id,kind,created_at,updated_at) VALUES ('lv1','l1','b1','v1','personal',1,1);
        INSERT INTO book_states(user_id,book_version_id,read_status,progress_data,updated_at)
          VALUES ('u1','v1','finished','{"intervals":[[0,0.5]]}',1000),('u2','v1','reading','{"intervals":[[0,0.1]]}',1000);
        INSERT INTO book_states(user_id,book_version_id,read_status,updated_at) VALUES ('u2','v2','wishlist',0);
        INSERT INTO reading_records(id,user_id,book_id,book_version_id,date,duration_seconds)
          VALUES ('d1','u1','v1','v1','2026-10-01',180),('d2','u1','v2','v2','2026-10-02',90);
        INSERT INTO reading_sessions(id,user_id,book_id,book_version_id,date,started_at,duration_seconds,ended_at,start_fraction,end_fraction)
          VALUES ('s1','u1','v1','v1','2026-10-01',100,120,120100,0.1234,0.5);
      `)
      migrate(db, { migrationsFolder })
      expect(sqlite.prepare('SELECT id,book_version_id,date,duration_seconds FROM reading_records ORDER BY id').all()).toEqual([
        { id: 'd1', book_version_id: 'v1', date: '2026-10-01', duration_seconds: 180 },
        { id: 'd2', book_version_id: 'v2', date: '2026-10-02', duration_seconds: 90 },
      ])
      expect(sqlite.prepare('SELECT source,timezone,fragments,coverage,start_fraction,end_fraction FROM reading_sessions WHERE id = ?').get('s1')).toEqual({
        source: 'legacy', timezone: null, fragments: '[]', coverage: '[]', start_fraction: 0.1234, end_fraction: 0.5,
      })
      expect(sqlite.prepare('SELECT title,author,legacy_intervals,legacy_daily FROM reading_archives WHERE user_id = ? AND book_version_id = ?').get('u1', 'v1')).toEqual({
        title: 'My title', author: 'My author', legacy_intervals: '[[0,0.5]]', legacy_daily: '[{"date":"2026-10-01","durationSeconds":60}]',
      })
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM reading_archives WHERE user_id = ? AND book_version_id = ?').get('u2', 'v2')).toEqual({ n: 0 })
      expect(sqlite.prepare('SELECT title,author FROM reading_archives WHERE user_id = ?').get('u2')).toEqual({ title: 'Unavailable book', author: '' })
      expect(sqlite.prepare('SELECT status,ended_at FROM reading_rounds WHERE user_id = ? AND book_version_id = ?').get('u1', 'v1')).toEqual({ status: 'finished', ended_at: 1000 })
      sqlite.exec("DELETE FROM library_book_versions; DELETE FROM library_books; DELETE FROM libraries; DELETE FROM book_versions;")
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM reading_sessions').get()).toEqual({ n: 1 })
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM reading_records').get()).toEqual({ n: 2 })
      retargetBookIdReferences(db)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      sqlite.exec("INSERT INTO reading_timer_claims VALUES ('u1','device','auto',1,2); DELETE FROM users WHERE id = 'u1';")
      for (const table of ['reading_sessions', 'reading_records', 'reading_rounds', 'reading_timer_claims']) {
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'u1'`).get()).toEqual({ n: 0 })
      }
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM reading_archives WHERE user_id = ?').get('u1')).toEqual({ n: 0 })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally { sqlite.close() }
  })
})
