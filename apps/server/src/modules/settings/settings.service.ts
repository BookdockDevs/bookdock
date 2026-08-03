import { and, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import type { SettingsRes, TrashSettings } from '@bookdock/shared'

const UI_KEY = 'ui'
const TRASH_KEY = 'trash'

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

export function updateTrashSettings(userId: string, value: TrashSettings) {
  upsertValue(userId, TRASH_KEY, value)
}
