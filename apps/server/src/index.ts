import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { serve } from '@hono/node-server'

import app from './app'
import { config } from './config'
import { runMigrations } from './db/client'
import { log } from './lib/logger'
import { pruneOldContentRevisions, purgeAllExpiredTrash } from './modules/books/books.service'
import { purgeAllLibraryTrash } from './modules/libraries/catalog.service'
import { interruptStaleAiGenerationRuns } from './modules/ai/ai.runs.service'

const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

async function runTrashSweep() {
  const startedAt = Date.now()
  try {
    await purgeAllExpiredTrash()
    await purgeAllLibraryTrash()
    const pruned = await pruneOldContentRevisions()
    if (pruned.prunedRevisions > 0 || pruned.deletedBlobs > 0) {
      log('info', 'books.revision_prune.completed', { durationMs: Date.now() - startedAt, meta: { ...pruned } })
    }
    log('info', 'trash.sweep.completed', { durationMs: Date.now() - startedAt })
  } catch (err) {
    // Trash cleanup is deliberately fail-silent so an operational cleanup
    // problem never makes an otherwise healthy library unavailable.
    log('warn', 'trash.sweep.failed', { durationMs: Date.now() - startedAt, error: err })
  }
}

async function start() {
  const startedAt = Date.now()
  log('info', 'server.starting')

  const migrationStartedAt = Date.now()
  try {
    await runMigrations()
    log('info', 'database.migration.completed', { durationMs: Date.now() - migrationStartedAt })
    const interruptedRuns = interruptStaleAiGenerationRuns()
    if (interruptedRuns > 0) log('info', 'ai.generation.stale_runs_interrupted', { meta: { count: interruptedRuns } })
  } catch (err) {
    log('error', 'database.migration.failed', { durationMs: Date.now() - migrationStartedAt, error: err })
    process.exitCode = 1
    return
  }

  await runTrashSweep()
  // Long-running containers never hit the boot sweep or open the trash, so
  // expired rows would hold storage indefinitely without this.
  setInterval(() => void runTrashSweep(), TRASH_SWEEP_INTERVAL_MS).unref()

  try {
    serve(
      { fetch: app.fetch, port: config.port },
      (info: AddressInfo) => log('info', 'server.listening', {
        durationMs: Date.now() - startedAt,
        meta: {
          port: info.port,
          storageDriver: config.storageDriver,
          defaultDbPath: path.resolve(config.dbPath) === path.resolve(config.dataDir, 'bookdock.db'),
        },
      }),
    )
  } catch (err) {
    log('error', 'server.listening.failed', { error: err })
    process.exitCode = 1
  }
}

void start()
