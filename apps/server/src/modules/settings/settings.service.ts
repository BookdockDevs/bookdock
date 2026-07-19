import { and, eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import type { SettingsRes } from '@bookdock/shared'

const UI_KEY = 'ui'

export function getSettings(userId: string): SettingsRes | null {
  const db = getDb()
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, UI_KEY)))
    .get()
  return row ? (row.value as SettingsRes) : null
}

export function updateSettings(userId: string, value: SettingsRes) {
  const db = getDb()
  const existing = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, UI_KEY)))
    .get()
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.id, existing.id)).run()
  } else {
    db.insert(settings).values({
      id: createId('setting'),
      userId,
      key: UI_KEY,
      value,
    }).run()
  }
}
