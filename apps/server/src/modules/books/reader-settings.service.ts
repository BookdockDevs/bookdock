import { and, desc, eq } from 'drizzle-orm'

import { readerBookSettingsSchema } from '@bookdock/shared'
import type { ReaderBookSettings, ViewSettings } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentRevisions, libraryBookVersions, libraries, settings } from '../../db/schema'
import { createId } from '../../lib/id'

const READER_BOOK_SETTINGS_PREFIX = 'reader.book:'

function settingsKey(bookId: string) {
  return `${READER_BOOK_SETTINGS_PREFIX}${bookId}`
}

function privateLink(userId: string, bookId: string) {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries).where(and(
    eq(libraries.userId, userId),
    eq(libraries.type, 'private'),
  )).get()
  if (!library) return null
  return db.select({ kind: libraryBookVersions.kind }).from(libraryBookVersions).where(and(
    eq(libraryBookVersions.libraryId, library.id),
    eq(libraryBookVersions.bookVersionId, bookId),
  )).get() ?? null
}

function storedSettings(userId: string, bookId: string): ReaderBookSettings | null {
  const row = getDb().select({ value: settings.value }).from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, settingsKey(bookId)),
  )).get()
  if (!row) return null
  const parsed = readerBookSettingsSchema.safeParse(row.value)
  if (!parsed.success) return null
  return {
    ...(parsed.data.viewSettings !== undefined && parsed.data.viewSettings !== null ? { viewSettings: parsed.data.viewSettings } : {}),
    ...(parsed.data.boundPresetId !== undefined && parsed.data.boundPresetId !== null ? { boundPresetId: parsed.data.boundPresetId } : {}),
  }
}

function saveSettings(userId: string, bookId: string, value: ReaderBookSettings) {
  const db = getDb()
  const key = settingsKey(bookId)
  const existing = db.select({ id: settings.id }).from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, key),
  )).get()
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.id, existing.id)).run()
    return
  }
  db.insert(settings).values({ id: createId('setting'), userId, key, value }).run()
}

function migrateLegacySettings(userId: string, bookId: string): ReaderBookSettings {
  const link = privateLink(userId, bookId)
  if (!link || link.kind === 'shared') return {}

  const revision = getDb().select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId))
    .orderBy(desc(contentRevisions.revisionNo))
    .all().at(0)
  const meta = (revision?.meta ?? {}) as Record<string, unknown>
  const legacyViewSettings = readerBookSettingsSchema.shape.viewSettings.safeParse(meta.viewSettings)
  const legacyBoundPresetId = readerBookSettingsSchema.shape.boundPresetId.safeParse(meta.boundPresetId)
  const migrated: ReaderBookSettings = {
    ...(legacyViewSettings.success && legacyViewSettings.data !== undefined && legacyViewSettings.data !== null ? { viewSettings: legacyViewSettings.data } : {}),
    ...(legacyBoundPresetId.success && legacyBoundPresetId.data !== undefined && legacyBoundPresetId.data !== null ? { boundPresetId: legacyBoundPresetId.data } : {}),
  }
  if (revision && Object.keys(migrated).length > 0) {
    delete meta.viewSettings
    delete meta.boundPresetId
    getDb().update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, revision.id)).run()
    saveSettings(userId, bookId, migrated)
  }
  return migrated
}

export function getReaderBookSettings(userId: string | null, bookId: string): ReaderBookSettings {
  if (userId === null) return {}
  return storedSettings(userId, bookId) ?? migrateLegacySettings(userId, bookId)
}

export function updateReaderBookSettings(userId: string, bookId: string, input: { viewSettings?: ViewSettings | null; boundPresetId?: string | null }) {
  const current = getReaderBookSettings(userId, bookId)
  const next: ReaderBookSettings = { ...current }
  if (input.viewSettings === null) delete next.viewSettings
  else if (input.viewSettings !== undefined) next.viewSettings = { ...(current.viewSettings ?? {}), ...input.viewSettings }
  if (input.boundPresetId === null) delete next.boundPresetId
  else if (input.boundPresetId !== undefined) next.boundPresetId = input.boundPresetId
  saveSettings(userId, bookId, next)
  return next
}
