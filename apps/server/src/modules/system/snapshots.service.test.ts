import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { config } from '../../config'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { createSnapshot, deleteSnapshot, listSnapshots, releaseSnapshotRetention } from './snapshots.service'

vi.mock('../../config', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  return { config: { dataDir: nodePath.join(os.tmpdir(), `bookdock-snapshots-test-${process.pid}`) } }
})

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')
const snapshotsRoot = path.join(config.dataDir, 'snapshots')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return db
}

let db: ReturnType<typeof createTestDb>
let userId: string

beforeEach(async () => {
  db = createTestDb()
  userId = createId('user')
  db.insert(schema.users).values({ id: userId, username: `user-${userId}`, createdAt: Date.now() }).run()
  db.insert(schema.instanceSettings).values({ key: 'allowGuestAccess', value: 'false' }).run()
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  await rm(snapshotsRoot, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Snapshot ids carry the creation timestamp, so multi-snapshot tests need distinct clocks. */
function freezeClockAt(epochMs: number) {
  vi.spyOn(Date, 'now').mockReturnValue(epochMs)
}

/** Stand-in for a snapshot written by another release, without paying for a real backup. */
async function seedSnapshot(id: string, createdAt: number) {
  const dir = path.join(snapshotsRoot, id)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'bookdock.db'), 'placeholder')
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ appVersion: id.slice(0, id.lastIndexOf('-')), createdAt, instanceSettings: {} }))
}

describe('snapshots service', () => {
  it('copies the live database and settings into a versioned snapshot directory', async () => {
    freezeClockAt(1_760_000_000_000)

    const snapshot = await createSnapshot()

    expect(snapshot).toMatchObject({
      id: `0.3.2-1760000000000`,
      appVersion: '0.3.2',
      createdAt: 1_760_000_000_000,
      instanceSettings: { allowGuestAccess: 'false' },
    })
    expect(snapshot.sizeBytes).toBeGreaterThan(0)

    const copied = new Database(path.join(snapshotsRoot, snapshot.id, 'bookdock.db'), { readonly: true })
    const users = copied.prepare('SELECT id FROM users').all() as Array<{ id: string }>
    copied.close()
    expect(users).toEqual([{ id: userId }])

    const manifest = JSON.parse(await readFile(path.join(snapshotsRoot, snapshot.id, 'manifest.json'), 'utf8'))
    expect(manifest).toEqual({
      appVersion: '0.3.2',
      createdAt: 1_760_000_000_000,
      instanceSettings: { allowGuestAccess: 'false' },
    })
  })

  it('does not mutate the live database while snapshotting', async () => {
    const before = db.select().from(schema.users).all()

    await createSnapshot()

    expect(db.select().from(schema.users).all()).toEqual(before)
    expect(db.$client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  })

  it('lists snapshots newest first', async () => {
    await seedSnapshot('0.3.2-1760000000000', 1_760_000_000_000)
    await seedSnapshot('0.3.2-1760000000500', 1_760_000_000_500)

    expect((await listSnapshots()).map((snapshot) => snapshot.createdAt)).toEqual([1_760_000_000_500, 1_760_000_000_000])
  })

  it('orders by creation time, not by version string', async () => {
    // `0.3.2` sorts above `0.10.0` as text, so a naive directory sort would
    // retire the newest snapshot first.
    await seedSnapshot('0.3.2-1760000000000', 1_760_000_000_000)
    await seedSnapshot('0.10.0-1760000001000', 1_760_000_001_000)

    expect((await listSnapshots()).map((snapshot) => snapshot.id)).toEqual(['0.10.0-1760000001000', '0.3.2-1760000000000'])
  })

  it('still lists a snapshot whose manifest is unreadable', async () => {
    await seedSnapshot('0.3.2-1760000000000', 1_760_000_000_000)
    await rm(path.join(snapshotsRoot, '0.3.2-1760000000000', 'manifest.json'))

    expect(await listSnapshots()).toEqual([{ id: '0.3.2-1760000000000', appVersion: '0.3.2', createdAt: 1_760_000_000_000, sizeBytes: expect.any(Number) }])
  })

  it('lists and deletes a snapshot taken by a prerelease build', async () => {
    // Release tags may carry a prerelease suffix (see the release workflow), and
    // the id pattern is also the traversal guard, so both must agree.
    await seedSnapshot('0.4.0-beta.1-1760000000000', 1_760_000_000_000)

    expect(await listSnapshots()).toEqual([{ id: '0.4.0-beta.1-1760000000000', appVersion: '0.4.0-beta.1', createdAt: 1_760_000_000_000, sizeBytes: expect.any(Number), instanceSettings: {} }])
    await deleteSnapshot('0.4.0-beta.1-1760000000000')
    expect(await listSnapshots()).toEqual([])
  })

  it('prunes to the newest snapshot after each creation', async () => {
    const created: string[] = []
    for (const offset of [0, 1, 2, 3, 4, 5]) {
      freezeClockAt(1_760_000_000_000 + offset)
      created.push((await createSnapshot()).id)
    }

    const remaining = await listSnapshots()
    expect(remaining.map((snapshot) => snapshot.id)).toEqual([created.at(-1)])
    await expect(readdir(snapshotsRoot)).resolves.toHaveLength(1)
  })

  it('keeps an update snapshot beyond retention and refuses deletion until pending resolves', async () => {
    freezeClockAt(1_760_000_000_000)
    const snapshot = await createSnapshot({ retainForUpdate: true })
    for (let offset = 1; offset <= 6; offset += 1) {
      freezeClockAt(1_760_000_000_000 + offset)
      await createSnapshot()
    }

    expect((await listSnapshots()).map((entry) => entry.id)).toContain(snapshot.id)
    await expect(readdir(snapshotsRoot)).resolves.toHaveLength(2)
    await expect(deleteSnapshot(snapshot.id)).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' })

    releaseSnapshotRetention(snapshot.id)
    const releasesDir = path.join(config.dataDir, 'releases')
    await mkdir(releasesDir, { recursive: true })
    await writeFile(path.join(releasesDir, 'pending'), JSON.stringify({ target: '0.4.0', snapshot: snapshot.id, progressId: 'p1' }))
    freezeClockAt(1_760_000_000_007)
    await createSnapshot()

    expect((await listSnapshots()).map((entry) => entry.id)).toContain(snapshot.id)
    await expect(deleteSnapshot(snapshot.id)).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' })

    await rm(path.join(releasesDir, 'pending'), { force: true })
    await deleteSnapshot(snapshot.id)
    expect((await listSnapshots()).map((entry) => entry.id)).not.toContain(snapshot.id)
  })

  it('removes a snapshot on delete', async () => {
    const snapshot = await createSnapshot()

    await deleteSnapshot(snapshot.id)

    expect(await listSnapshots()).toEqual([])
  })

  it('rejects unknown and malformed snapshot ids', async () => {
    await expect(deleteSnapshot('0.3.2-9999999999999')).rejects.toThrow(AppError)
    await expect(deleteSnapshot('../files')).rejects.toThrow(AppError)
  })
})
