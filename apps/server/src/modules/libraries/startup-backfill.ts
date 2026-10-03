import { desc, eq, ne, sql } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraryMigrationLog, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { log } from '../../lib/logger'
import {
  backfillRevisionMeta,
  backfillUserFields,
  backfillVersionReferences,
  migrateAnnotations,
  migrateLibraryOrganization,
  migratePrivateLibraries,
  migrateReadingStates,
  seedInstance,
  verifyPhase2Migration,
  type VerifyReport,
} from './library-migration'

export const STARTUP_BACKFILL_BATCHES = [
  'phase2-users',
  'phase2-private-libraries',
  'phase2-organization',
  'phase2-reading-states',
  'phase2-annotations',
  'phase2-references',
  'phase2-instance',
  'phase3-revision-meta',
]

/**
 * The verification outcome is a ledger row of its own, not an afterthought:
 * batch `completed` rows only say the steps ran. A failed (or missing)
 * verification must never fast-path the next boot into `skipped-complete`.
 */
export const STARTUP_BACKFILL_VERIFY_BATCH = 'phase2-verify'

export type StartupBackfillOutcome =
  | { status: 'skipped-fresh' }
  | { status: 'skipped-complete' }
  | { status: 'completed'; verify: VerifyReport }

/**
 * Phase 2 data backfill for the production boot path (Docker and in-app
 * updates both start through index.ts). Every step is idempotent with its own
 * migration-log row; steady-state boots fast-path out on the ledger without
 * rerunning anything — but only when the latest verification itself passed.
 * A failed or missing verification re-runs the steps instead of skipping.
 *
 * Fresh installs (no real users yet) skip: Phase 3 setup creates the user,
 * private library and instance atomically, so there is nothing to backfill.
 * Genuinely blocked databases (username clashes, ambiguous owners, failed
 * verification) throw and refuse to boot — serving an empty library over
 * un-migrated books is worse than a loud startup failure with a backup
 * already mandated by the upgrade notes.
 */
export async function runPhase2StartupBackfill(): Promise<StartupBackfillOutcome> {
  const db = getDb()
  if (!db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'`)) {
    return { status: 'skipped-complete' }
  }
  const realUsers = db.select({ id: users.id }).from(users).where(ne(users.role, 'guest')).all()
  if (realUsers.length === 0) {
    log('info', 'library.startup_backfill.skipped_fresh')
    return { status: 'skipped-fresh' }
  }
  const finished = new Set<string>()
  for (const row of db.select().from(libraryMigrationLog).all()) {
    if (row.status === 'completed') finished.add(row.batch)
  }
  if (STARTUP_BACKFILL_BATCHES.every((batch) => finished.has(batch)) && latestVerifyPassed()) {
    log('info', 'library.startup_backfill.skipped_complete')
    return { status: 'skipped-complete' }
  }
  const startedAt = Date.now()
  await backfillUserFields()
  await migratePrivateLibraries()
  await migrateLibraryOrganization()
  await migrateReadingStates()
  await migrateAnnotations()
  await backfillVersionReferences()
  await seedInstance()
  await backfillRevisionMeta()
  const verify = await verifyPhase2Migration()
  const failed = verify.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`)
  db.insert(libraryMigrationLog).values({
    id: createId('mig'), batch: STARTUP_BACKFILL_VERIFY_BATCH,
    status: verify.pass ? 'completed' : 'failed',
    details: verify.pass ? {} : { failed },
    startedAt, finishedAt: Date.now(),
  }).run()
  if (!verify.pass) {
    throw new Error(`Phase 2 startup backfill verification failed: ${failed.join('; ')}`)
  }
  log('info', 'library.startup_backfill.completed', { durationMs: Date.now() - startedAt })
  return { status: 'completed', verify }
}

/** The latest verification row decides: only `completed` unlocks the fast path. */
function latestVerifyPassed(): boolean {
  const latest = getDb().select().from(libraryMigrationLog)
    .where(eq(libraryMigrationLog.batch, STARTUP_BACKFILL_VERIFY_BATCH))
    .orderBy(desc(libraryMigrationLog.startedAt), desc(libraryMigrationLog.id))
    .limit(1).get()
  return latest?.status === 'completed'
}
