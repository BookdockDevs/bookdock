import { runMigrations } from '../../db/client'
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
} from './library-migration'

/**
 * Phase 2 drill/apply runner (2.1-2.11 + 2.9 verification). Every step is
 * idempotent: reruns skip whatever already migrated. Point DATA_DIR at a
 * COPY for drills, at the real data dir only with a backup taken (0.4).
 * Never run against a database that the running server has open.
 * 2.12 needs no code: JWTs are never converted to sessions, web logins
 * re-authenticate under the new session scheme in Phase 3.
 *
 * The steps run as the beforeRetarget hook so the composition matches
 * production boot (index.ts): backfill first, book-id retarget second.
 */
await runMigrations({
  beforeRetarget: async () => {
    const users = await backfillUserFields()
    const books = await migratePrivateLibraries()
    const seeded = await seedInstance()
    const report = {
      users,
      books,
      organization: await migrateLibraryOrganization(),
      states: await migrateReadingStates(),
      annotations: await migrateAnnotations(),
      references: await backfillVersionReferences(),
      instance: seeded,
      revisionMeta: await backfillRevisionMeta(),
    }
    const verify = await verifyPhase2Migration()
    console.log(JSON.stringify({ ...report, verify }, null, 2))
    if (!verify.pass) {
      const failed = verify.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`).join('; ')
      throw new Error(`Phase 2 verification failed: ${failed}`)
    }
  },
})
