import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import app from './app'
import { config } from './config'
import { getDb, runMigrations } from './db/client'
import { users } from './db/schema'
import { bootstrapAuth } from './modules/auth/auth.service'
import { purgeExpiredTrash } from './modules/books/books.service'
import { getTrashSettings } from './modules/settings/settings.service'

runMigrations()
bootstrapAuth()

// Sweep every user's expired trash once at boot; failures must never block startup
void (async () => {
  try {
    for (const { id } of getDb().select({ id: users.id }).from(users).all()) {
      await purgeExpiredTrash(id, getTrashSettings(id).autoCleanDays)
    }
  } catch (err) {
    console.error('trash auto-clean failed:', err)
  }
})()

serve(
  { fetch: app.fetch, port: config.port },
  (info: AddressInfo) => console.log(`bookdock server running on http://localhost:${info.port}`),
)
