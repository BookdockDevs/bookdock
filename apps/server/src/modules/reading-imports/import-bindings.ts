import { and, eq } from 'drizzle-orm'

import type { ReadingImportSource } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { readingImportBindings } from '../../db/schema'
import { createId } from '../../lib/id'

type Db = ReturnType<typeof getDb>
type BindingRow = typeof readingImportBindings.$inferSelect

/** Source book -> target resolution. This table is the only identity source:
 * preview status, apply, re-import and "already mounted" all read it, so a
 * mount cannot be silently undone by the next import (0.11 #2). */
export interface ImportBinding {
  id: string
  bookKey: string
  accountKey: string
  targetBookVersionId: string
  mode: 'archive' | 'mounted'
  mountedAt: number | null
}

function toBinding(row: BindingRow): ImportBinding {
  return {
    id: row.id,
    bookKey: row.bookKey,
    accountKey: row.accountKey,
    targetBookVersionId: row.targetBookVersionId,
    mode: row.mode,
    mountedAt: row.mountedAt,
  }
}

/** All bindings of one dataset, keyed by source book. */
export function listBindings(
  userId: string,
  source: ReadingImportSource,
  accountKey: string,
  db: Db = getDb(),
): Map<string, ImportBinding> {
  const rows = db.select().from(readingImportBindings).where(and(
    eq(readingImportBindings.userId, userId),
    eq(readingImportBindings.source, source),
    eq(readingImportBindings.accountKey, accountKey),
  )).all()
  return new Map(rows.map((row) => [row.bookKey, toBinding(row)]))
}

export function listSourceBindings(
  userId: string,
  source: ReadingImportSource,
  db: Db = getDb(),
): Map<string, ImportBinding> {
  const rows = db.select().from(readingImportBindings).where(and(
    eq(readingImportBindings.userId, userId),
    eq(readingImportBindings.source, source),
  )).all()
  return new Map(rows.map((row) => [row.bookKey, toBinding(row)]))
}

export function findBinding(
  userId: string,
  source: ReadingImportSource,
  accountKey: string,
  bookKey: string,
  db: Db = getDb(),
): ImportBinding | null {
  const row = db.select().from(readingImportBindings).where(and(
    eq(readingImportBindings.userId, userId),
    eq(readingImportBindings.source, source),
    eq(readingImportBindings.accountKey, accountKey),
    eq(readingImportBindings.bookKey, bookKey),
  )).get()
  return row ? toBinding(row) : null
}

/** Create the archive-mode binding that a fresh import owns. Written in the
 * same transaction as the archive row: a binding without an archive, or an
 * archive without a binding, would both break the next import. */
export function createArchiveBinding(
  tx: Db,
  input: {
    userId: string
    source: ReadingImportSource
    accountKey: string
    bookKey: string
    archiveId: string
    now: number
  },
): void {
  tx.insert(readingImportBindings).values({
    id: createId('rib'),
    userId: input.userId,
    source: input.source,
    accountKey: input.accountKey,
    bookKey: input.bookKey,
    targetBookVersionId: input.archiveId,
    mode: 'archive',
    autoSync: false,
    lastSyncedAt: null,
    mountedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: [
      readingImportBindings.userId,
      readingImportBindings.source,
      readingImportBindings.accountKey,
      readingImportBindings.bookKey,
    ],
    // Only repair a stale archive-mode pointer. A mounted binding must never be
    // dragged back to an archive id by creating a new one.
    set: { targetBookVersionId: input.archiveId, updatedAt: input.now },
    setWhere: eq(readingImportBindings.mode, 'archive'),
  }).run()
}

/** Point the binding at the real book. Called inside the mount transaction
 * right before the archive row is deleted. */
export function markMounted(tx: Db, bindingId: string, targetBookVersionId: string, now: number): void {
  tx.update(readingImportBindings).set({
    targetBookVersionId,
    mode: 'mounted',
    mountedAt: now,
    updatedAt: now,
  }).where(eq(readingImportBindings.id, bindingId)).run()
}

/** Deleting a personal book together with its personal data removes the rows
 * the target pointed at, so the binding goes too. Keeping the book while
 * keeping its data (deleteUserData = false) deliberately keeps the binding:
 * the archive snapshot reuses the same bookVersionId (0.11). */
export function deleteBindingsForTarget(tx: Db, userId: string, bookVersionId: string): void {
  tx.delete(readingImportBindings).where(and(
    eq(readingImportBindings.userId, userId),
    eq(readingImportBindings.targetBookVersionId, bookVersionId),
  )).run()
}

/** Removing an import archive removes its identity with it. */
export function deleteBindingsForArchive(tx: Db, userId: string, archiveId: string): void {
  tx.delete(readingImportBindings).where(and(
    eq(readingImportBindings.userId, userId),
    eq(readingImportBindings.mode, 'archive'),
    eq(readingImportBindings.targetBookVersionId, archiveId),
  )).run()
}
