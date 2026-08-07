import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import app from './app'
import { config } from './config'
import { runMigrations } from './db/client'
import { bootstrapAuth } from './modules/auth/auth.service'
import { purgeAllExpiredTrash } from './modules/books/books.service'

runMigrations()
bootstrapAuth()

// Sweep every user's expired trash once at boot; failures must never block startup
void (async () => {
  try {
    await purgeAllExpiredTrash()
  } catch (err) {
    console.error('trash auto-clean failed:', err)
  }
})()

serve(
  { fetch: app.fetch, port: config.port },
  (info: AddressInfo) => console.log(`bookdock server running on http://localhost:${info.port}`),
)
