import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import app from './app'
import { config } from './config'
import { runMigrations } from './db/client'
import { bootstrapAuth } from './modules/auth/auth.service'

runMigrations()
bootstrapAuth()

serve(
  { fetch: app.fetch, port: config.port },
  (info: AddressInfo) => console.log(`bookdock server running on http://localhost:${info.port}`),
)
