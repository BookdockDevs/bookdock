import { and, eq, ne, sql } from 'drizzle-orm'

import { readerBookSettingsSchema } from '@bookdock/shared'
import type { ReaderBookSettings, ReadingThemeSelectionState, ViewSettings } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentRevisions, libraries, libraryBookVersions, settings } from '../../db/schema'
import { createId } from '../../lib/id'

const READER_BOOK_SETTINGS_PREFIX = 'reader.book:'

function settingsKey(bookId: string) {
  return `${READER_BOOK_SETTINGS_PREFIX}${bookId}`
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
    ...(parsed.data.themeSelection ? { themeSelection: parsed.data.themeSelection } : {}),
    ...(parsed.data.readingThemeId !== undefined && parsed.data.readingThemeId !== null ? { readingThemeId: parsed.data.readingThemeId } : {}),
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

export function migrateAllLegacyBookSettings(db: ReturnType<typeof getDb>) {
  const tables = new Set(
    (db.all(sql.raw("SELECT name FROM sqlite_master WHERE type = 'table'")) as Array<{ name: string }>).map(({ name }) => name),
  )
  if (!tables.has('content_revisions') || !tables.has('settings')) return

  const candidateRevisions = db.all(sql.raw(
    "SELECT id, book_version_id, revision_no, meta FROM content_revisions WHERE meta LIKE '%viewSettings%' OR meta LIKE '%boundPresetId%'"
  )) as Array<{ id: string; book_version_id: string; revision_no: number; meta: string | Record<string, unknown> | null }>

  if (candidateRevisions.length === 0) return

  const bookVersionIds = [...new Set(candidateRevisions.map((r) => r.book_version_id))]

  for (const bookVersionId of bookVersionIds) {
    // Find the ACTUAL latest revision for this bookVersionId across all content_revisions
    const latestRow = db.all(sql.raw(
      `SELECT id, meta FROM content_revisions WHERE book_version_id = '${bookVersionId.replace(/'/g, "''")}' ORDER BY revision_no DESC LIMIT 1`
    ))[0] as { id: string; meta: string | Record<string, unknown> | null } | undefined

    if (latestRow) {
      const rawMeta = typeof latestRow.meta === 'string' ? JSON.parse(latestRow.meta) : (latestRow.meta ?? {})
      const meta = (rawMeta && typeof rawMeta === 'object') ? (rawMeta as Record<string, unknown>) : {}
      const legacyViewSettings = readerBookSettingsSchema.shape.viewSettings.safeParse(meta.viewSettings)
      const legacyBoundPresetId = readerBookSettingsSchema.shape.boundPresetId.safeParse(meta.boundPresetId)

      const migrated: ReaderBookSettings = {
        ...(legacyViewSettings.success && legacyViewSettings.data !== undefined && legacyViewSettings.data !== null ? { viewSettings: legacyViewSettings.data } : {}),
        ...(legacyBoundPresetId.success && legacyBoundPresetId.data !== undefined && legacyBoundPresetId.data !== null ? { boundPresetId: legacyBoundPresetId.data } : {}),
      }

      if (Object.keys(migrated).length > 0) {
        const link = db.select({
          userId: libraries.userId,
        }).from(libraryBookVersions)
          .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
          .where(and(
            eq(libraryBookVersions.bookVersionId, bookVersionId),
            eq(libraries.type, 'private'),
            ne(libraryBookVersions.kind, 'shared'),
          ))
          .get()

        if (link?.userId) {
          const key = `${READER_BOOK_SETTINGS_PREFIX}${bookVersionId}`
          const existing = db.select({ id: settings.id }).from(settings).where(and(
            eq(settings.userId, link.userId),
            eq(settings.key, key),
          )).get()
          if (!existing) {
            db.insert(settings).values({
              id: createId('setting'),
              userId: link.userId,
              key,
              value: migrated,
            }).run()
          }
        }
      }
    }

    // Clean up all candidate revisions that contain legacy fields for this bookVersionId
    const revisionsToClean = candidateRevisions.filter((r) => r.book_version_id === bookVersionId)
    for (const row of revisionsToClean) {
      const rawMeta = typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta ?? {})
      const meta = (rawMeta && typeof rawMeta === 'object') ? { ...(rawMeta as Record<string, unknown>) } : {}
      delete meta.viewSettings
      delete meta.boundPresetId
      db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, row.id)).run()
    }
  }
}

export function getReaderBookSettings(userId: string | null, bookId: string): ReaderBookSettings {
  if (userId === null) return {}
  return storedSettings(userId, bookId) ?? {}
}

export function updateReaderBookSettings(userId: string, bookId: string, input: { themeSelection?: ReadingThemeSelectionState | null; viewSettings?: ViewSettings | null; boundPresetId?: string | null; readingThemeId?: string | null }) {
  const current = getReaderBookSettings(userId, bookId)
  const next: ReaderBookSettings = { ...current }
  if (input.viewSettings === null) delete next.viewSettings
  else if (input.viewSettings !== undefined) next.viewSettings = { ...(current.viewSettings ?? {}), ...input.viewSettings }
  if (input.boundPresetId === null) delete next.boundPresetId
  else if (input.boundPresetId !== undefined) next.boundPresetId = input.boundPresetId
  if (input.readingThemeId === null) delete next.readingThemeId
  else if (input.readingThemeId !== undefined) next.readingThemeId = input.readingThemeId
  if (input.themeSelection !== undefined) {
    delete next.readingThemeId
    if (input.themeSelection === null) delete next.themeSelection
    else next.themeSelection = input.themeSelection
  }
  saveSettings(userId, bookId, next)
  return next
}
