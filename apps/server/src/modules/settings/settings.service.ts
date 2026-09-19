import { and, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import type { IntegrationsSettings, LibrarySettings, SettingsRes, TrashSettings } from '@bookdock/shared'

const UI_KEY = 'ui'
const TRASH_KEY = 'trash'
const LIBRARY_KEY = 'library'
const INTEGRATIONS_KEY = 'integrations'

const DEFAULT_TRASH: TrashSettings = { autoCleanDays: 30 }

function getValue<T>(userId: string, key: string): T | null {
  const db = getDb()
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)))
    .get()
  return row ? (row.value as T) : null
}

function upsertValue(userId: string, key: string, value: unknown) {
  const db = getDb()
  const existing = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)))
    .get()
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.id, existing.id)).run()
  } else {
    db.insert(settings).values({
      id: createId('setting'),
      userId,
      key,
      value,
    }).run()
  }
}

export function getSettings(userId: string): SettingsRes | null {
  return getValue<SettingsRes>(userId, UI_KEY)
}

export function updateSettings(userId: string, value: SettingsRes) {
  upsertValue(userId, UI_KEY, value)
}

export function getTrashSettings(userId: string): TrashSettings {
  return getValue<TrashSettings>(userId, TRASH_KEY) ?? DEFAULT_TRASH
}

/** Trash is on unless the stored settings explicitly disable it. */
export function isTrashEnabled(userId: string): boolean {
  return getTrashSettings(userId).enabled !== false
}

export function updateTrashSettings(userId: string, value: TrashSettings) {
  upsertValue(userId, TRASH_KEY, value)
}

export function getLibrarySettings(userId: string): LibrarySettings {
  return getValue<LibrarySettings>(userId, LIBRARY_KEY) ?? {}
}

/** File-name title normalization is on unless the stored settings disable it. */
export function isTitleNormalizeEnabled(userId: string): boolean {
  return getLibrarySettings(userId).normalizeTitle !== false
}

export function updateLibrarySettings(userId: string, value: LibrarySettings) {
  upsertValue(userId, LIBRARY_KEY, value)
}

export function getIntegrationsSettings(userId: string): IntegrationsSettings {
  return getValue<IntegrationsSettings>(userId, INTEGRATIONS_KEY) ?? {}
}

/** Legado source server is off until the user explicitly enables it. */
export function isLegadoEnabled(userId: string): boolean {
  return getIntegrationsSettings(userId).legado?.enabled === true
}

export function isLegadoAccessKeyEnabled(userId: string): boolean {
  const legado = getIntegrationsSettings(userId).legado
  return legado?.enabled === true && legado.authMode === 'accessKey'
}

/** EPUB media in Legado is included unless the stored settings disable it. */
export function isLegadoEpubMediaEnabled(userId: string): boolean {
  return getIntegrationsSettings(userId).legado?.includeEpubMedia !== false
}

export function updateIntegrationsSettings(userId: string, value: IntegrationsSettings) {
  upsertValue(userId, INTEGRATIONS_KEY, value)
}
