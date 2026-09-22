import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SnapshotRes } from '@bookdock/shared'
import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import { config } from '../../config'
import { getDb } from '../../db/client'
import { instanceSettings } from '../../db/schema'
import { AppError } from '../../middleware/error'

const DB_FILE_NAME = 'bookdock.db'
const MANIFEST_FILE_NAME = 'manifest.json'
/** Pre-update snapshots are the rollback seatbelt, not a backup archive; N-07 owns backups. */
const SNAPSHOT_RETENTION = 1
const retainedForUpdate = new Set<string>()

interface SnapshotManifest {
  appVersion: string
  createdAt: number
  instanceSettings: Record<string, string>
}

/**
 * Ids double as directory names, so the pattern is also the path-traversal
 * guard. The optional prerelease tag matches what `sync-version.mjs` accepts in
 * a version, so a `v0.4.0-beta.1` build can still take its own pre-update snapshot.
 */
const SNAPSHOT_ID_PATTERN = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)-(\d{10,})$/

function snapshotsRoot() {
  return path.join(config.dataDir, 'snapshots')
}

function snapshotDir(id: string) {
  const match = SNAPSHOT_ID_PATTERN.exec(id)
  if (!match) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot not found')
  return { dir: path.join(snapshotsRoot(), id), createdAt: Number(match[2]) }
}

async function readManifest(dir: string): Promise<SnapshotManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE_NAME), 'utf8')) as Partial<SnapshotManifest>
    if (typeof parsed.appVersion !== 'string' || typeof parsed.createdAt !== 'number') return null
    return {
      appVersion: parsed.appVersion,
      createdAt: parsed.createdAt,
      instanceSettings: typeof parsed.instanceSettings === 'object' && parsed.instanceSettings !== null ? parsed.instanceSettings : {},
    }
  } catch {
    return null
  }
}

export async function listSnapshots(): Promise<SnapshotRes[]> {
  const entries = await readdir(snapshotsRoot(), { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isDirectory() && SNAPSHOT_ID_PATTERN.test(entry.name))
    .map((entry) => snapshotDir(entry.name))
    .sort((left, right) => right.createdAt - left.createdAt)

  const snapshots: SnapshotRes[] = []
  for (const { dir, createdAt } of candidates) {
    const id = path.basename(dir)
    const manifest = await readManifest(dir)
    const sizeBytes = await stat(path.join(dir, DB_FILE_NAME)).then((s) => s.size).catch(() => 0)
    snapshots.push({
      id,
      appVersion: manifest?.appVersion ?? id.slice(0, id.lastIndexOf('-')),
      createdAt: manifest?.createdAt ?? createdAt,
      sizeBytes,
      ...(manifest ? { instanceSettings: manifest.instanceSettings } : {}),
    })
  }
  return snapshots
}

async function pruneSnapshots() {
  const snapshots = await listSnapshots()
  const pending = await readFile(path.join(config.dataDir, 'releases', 'pending'), 'utf8')
    .then((text) => JSON.parse(text) as { snapshot?: unknown })
    .catch(() => null)
  const retained = new Set([...retainedForUpdate, ...(typeof pending?.snapshot === 'string' && SNAPSHOT_ID_PATTERN.test(pending.snapshot) ? [pending.snapshot] : [])])
  const keep = new Set(snapshots.slice(0, SNAPSHOT_RETENTION).map((snapshot) => snapshot.id))
  for (const id of retained) keep.add(id)
  await Promise.all(snapshots.filter((snapshot) => !keep.has(snapshot.id)).map((snapshot) => rm(snapshotDir(snapshot.id).dir, { recursive: true, force: true })))
}

export async function createSnapshot({ retainForUpdate = false }: { retainForUpdate?: boolean } = {}): Promise<SnapshotRes> {
  const createdAt = Date.now()
  const id = `${BOOKDOCK_BUILD_INFO.version}-${createdAt}`
  const { dir } = snapshotDir(id)
  const db = getDb()
  const capturedSettings = Object.fromEntries(db.select().from(instanceSettings).all().map((row) => [row.key, row.value]))

  await mkdir(dir, { recursive: true })
  if (retainForUpdate) retainedForUpdate.add(id)
  try {
    await db.$client.backup(path.join(dir, DB_FILE_NAME))
    const manifest: SnapshotManifest = { appVersion: BOOKDOCK_BUILD_INFO.version, createdAt, instanceSettings: capturedSettings }
    await writeFile(path.join(dir, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (err) {
    // A partial snapshot directory would look like a valid rollback target.
    await rm(dir, { recursive: true, force: true })
    retainedForUpdate.delete(id)
    throw new AppError('SNAPSHOT_CREATE_FAILED', err instanceof Error ? err.message : 'Snapshot failed')
  }

  try {
    await pruneSnapshots()
    const snapshot = (await listSnapshots()).find((entry) => entry.id === id)
    if (!snapshot) throw new AppError('SNAPSHOT_CREATE_FAILED', 'Snapshot vanished after creation')
    return snapshot
  } catch (err) {
    retainedForUpdate.delete(id)
    throw err
  }
}

export function releaseSnapshotRetention(id: string) {
  retainedForUpdate.delete(id)
}

export async function deleteSnapshot(id: string): Promise<void> {
  const { dir } = snapshotDir(id)
  const pending = await readFile(path.join(config.dataDir, 'releases', 'pending'), 'utf8')
    .then((text) => JSON.parse(text) as { snapshot?: unknown })
    .catch(() => null)
  if (retainedForUpdate.has(id) || pending?.snapshot === id) {
    throw new AppError('UPDATE_IN_PROGRESS', 'Snapshot is required by an update in progress')
  }
  const exists = await stat(dir).then(() => true).catch(() => false)
  if (!exists) throw new AppError('SNAPSHOT_NOT_FOUND', 'Snapshot not found')
  await rm(dir, { recursive: true })
}
