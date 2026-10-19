import { and, eq, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

export function repairReadingLedgerSchema(db: BetterSQLite3Database<typeof schema>) {
  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(reading_archives)`)
  if (columns.length === 0) return

  // Early development boots recorded 0052 before these structures were added.
  db.transaction((tx) => {
    if (!columns.some((column) => column.name === 'legacy_revision_id')) {
      tx.run(sql`ALTER TABLE reading_archives ADD COLUMN legacy_revision_id TEXT`)
    }
    tx.run(sql`CREATE TABLE IF NOT EXISTS reading_write_receipts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      book_version_id TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      session_id TEXT REFERENCES reading_sessions(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      PRIMARY KEY(user_id,request_id)
    )`)
    tx.run(sql`CREATE INDEX IF NOT EXISTS reading_write_receipts_user_version_idx
      ON reading_write_receipts(user_id,book_version_id)`)
    tx.run(sql`INSERT INTO reading_write_receipts(user_id,request_id,book_version_id,body_hash,session_id,status)
      SELECT s.user_id,s.request_id,COALESCE(s.book_version_id,s.book_id),s.body_hash,s.id,'accepted'
      FROM reading_sessions s
      WHERE s.request_id IS NOT NULL AND s.body_hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM reading_write_receipts r WHERE r.user_id = s.user_id AND r.request_id = s.request_id)`)

    // The early INSERT SELECT * copied the retargeted table's physical column order.
    const misplaced = tx.all<{ id: string; userId: string; bookId: string; date: string; seconds: string }>(sql`
      SELECT id,user_id AS userId,book_id AS bookId,book_version_id AS date,date AS seconds
      FROM reading_records
      WHERE typeof(duration_seconds) = 'text' AND duration_seconds = book_id
        AND book_version_id GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND date <> '' AND date NOT GLOB '*[^0-9]*'
    `)
    for (const row of misplaced) {
      const durationSeconds = Number(row.seconds)
      if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0
        || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))) continue
      tx.run(sql`UPDATE reading_records SET book_version_id = ${row.bookId}, date = ${row.date},
        duration_seconds = ${durationSeconds} WHERE id = ${row.id}`)
      const archive = tx.select().from(schema.readingArchives).where(and(
        eq(schema.readingArchives.userId, row.userId), eq(schema.readingArchives.bookVersionId, row.bookId),
      )).get()
      if (!archive) continue
      const legacySeconds = tx.get<{ seconds: number }>(sql`SELECT COALESCE(SUM(duration_seconds),0) AS seconds
        FROM reading_sessions WHERE user_id = ${row.userId} AND book_id = ${row.bookId}
          AND date = ${row.date} AND source = 'legacy'`)!.seconds
      const residual = Math.max(0, durationSeconds - legacySeconds)
      if (residual <= 0) continue
      const daily = archive.legacyDaily.filter((item) => item.date !== row.date)
      daily.push({ date: row.date, durationSeconds: Math.max(residual, archive.legacyDaily.find((item) => item.date === row.date)?.durationSeconds ?? 0) })
      tx.update(schema.readingArchives).set({ legacyDaily: daily }).where(and(
        eq(schema.readingArchives.userId, row.userId), eq(schema.readingArchives.bookVersionId, row.bookId),
      )).run()
    }
  })
}
