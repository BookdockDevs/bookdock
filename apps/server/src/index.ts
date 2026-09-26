import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { serve } from '@hono/node-server'

import app from './app'
import { config } from './config'
import { runMigrations } from './db/client'
import { log } from './lib/logger'
import { migrateTxtArtifacts, purgeAllExpiredTrash } from './modules/books/books.service'
import { interruptStaleAiGenerationRuns } from './modules/ai/ai.runs.service'
import { runPhase2StartupBackfill } from './modules/libraries/startup-backfill'

const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

async function runTrashSweep() {
  const startedAt = Date.now()
  try {
    await purgeAllExpiredTrash()
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
    // Order matters: schema first, then the Phase 2 data backfill (legacy
    // books become versions), and only then the book-id retarget inside
    // runMigrations — retargeting before versions exist refuses to boot.
    // Fresh installs skip the backfill (setup creates everything); blocked
    // databases fail loud here instead of serving empty libraries.
    await runMigrations({ beforeRetarget: runPhase2StartupBackfill })
    log('info', 'database.migration.completed', { durationMs: Date.now() - migrationStartedAt })
    const txtArtifactMigrationStartedAt = Date.now()
    const txtArtifactMigration = await migrateTxtArtifacts()
    log('info', 'books.txt_artifact_migration.completed', {
      durationMs: Date.now() - txtArtifactMigrationStartedAt,
      meta: { ...txtArtifactMigration },
    })
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
