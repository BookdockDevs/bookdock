// Historical migration fixtures only; the retirement preflight owns final repairs.
import { sql } from 'drizzle-orm'

import type { getDb } from './client'

/**
 * Bookmarks migrated while the annotation split dropped their text/href
 * (title written as null, no chapter_href column yet) read back as bare
 * "书签" cards. The frozen legacy annotations table still holds both, so
 * backfill them: title unconditionally where a legacy row matches (empty
 * text displays identically), href only where the legacy row actually has
 * one. Rows created after the migration have no legacy counterpart and are
 * never touched. Idempotent.
 */
export function repairBookmarkFields(db: ReturnType<typeof getDb>) {
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

/**
 * Ideas migrated while the annotation split dropped their color/style/anchor
 * read back with default looks. The frozen legacy annotations table still
 * holds all three; post-migration writes never persisted color/style (the
 * new paths dropped them too), so the legacy row is the truth for every
 * matched row and newer rows without a legacy counterpart stay untouched.
 * Idempotent.
 */
export function repairIdeaStyle(db: ReturnType<typeof getDb>) {
  const tables = new Set(
    (db.all(sql.raw('SELECT name FROM sqlite_master WHERE type = \'table\'')) as Array<{ name: string }>).map(({ name }) => name),
  )
  if (!tables.has('ideas') || !tables.has('annotations')) return
  const columns = db.all(sql.raw('PRAGMA table_info(ideas)')) as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('color') || !names.has('style') || !names.has('cfi_anchor')) return
  db.run(sql.raw(`UPDATE "ideas" SET
    "color" = (SELECT "color" FROM "annotations" WHERE "annotations"."id" = "ideas"."id"),
    "style" = (SELECT "style" FROM "annotations" WHERE "annotations"."id" = "ideas"."id"),
    "cfi_anchor" = (SELECT "cfi_anchor" FROM "annotations" WHERE "annotations"."id" = "ideas"."id")
    WHERE EXISTS (
      SELECT 1 FROM "annotations" WHERE "annotations"."id" = "ideas"."id" AND "annotations"."type" = 'note'
    )`))
}

