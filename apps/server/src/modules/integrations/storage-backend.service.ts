import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import type {
  ClearStorageCacheRes,
  InspectStorageTargetReq,
  StorageBackendConfigRes,
  StorageMigrationStatusRes,
  StorageRestoreStatusRes,
  StorageTargetInspectionRes,
  TestStorageBackendReq,
  UpdateStorageBackendReq,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { blobs, fonts, instance, storageConnections, storageTransferTasks } from '../../db/schema'
import type { RemoteBrowseClient } from '../../lib/remote-client'
import { S3Client } from '../../lib/s3'
import { WebDavClient } from '../../lib/webdav'
import { AppError } from '../../middleware/error'
import { config } from '../../config'
import { resetStorage } from '../../storage'
import { LocalFsDriver } from '../../storage/localfs'
import { triggerLruEviction, triggerTransferWorker } from '../../storage/tiered'
import { createId } from '../../lib/id'
import { decryptPassword } from './webdav.service'

function buildProbeClient(conn: typeof storageConnections.$inferSelect): RemoteBrowseClient {
  const password = conn.encryptedPassword ? (decryptPassword(conn.encryptedPassword) || undefined) : undefined
  if (conn.provider === 's3') {
    return new S3Client({
      endpoint: conn.endpoint,
      region: conn.region || undefined,
      bucket: conn.bucket || '',
      accessKey: conn.username,
      secretKey: password,
      basePath: '/',
    })
  }
  return new WebDavClient({
    url: conn.endpoint,
    username: conn.username,
    password,
    basePath: '/',
  })
}

export async function getStorageBackendConfig(): Promise<StorageBackendConfigRes> {
  const db = getDb()
  const inst = db.select().from(instance).get()

  if (!inst) {
    throw new AppError('NOT_FOUND', 'Instance settings not found')
  }

  let connectionName: string | null = null
  let connectionEndpoint: string | null = null

  if (inst.storageBackendConnectionId) {
    const conn = db
      .select({ name: storageConnections.name, endpoint: storageConnections.endpoint })
      .from(storageConnections)
      .where(eq(storageConnections.id, inst.storageBackendConnectionId))
      .get()
    if (conn) {
      connectionName = conn.name
      connectionEndpoint = conn.endpoint
    }
  }

  // Calculate metrics
  const totalBookStats = db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(eq(blobs.kind, 'book'))
    .get()

  const totalCoverStats = db
    .select({
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(eq(blobs.kind, 'cover'))
    .get()

  const remoteStats = db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(
      and(
        eq(blobs.kind, 'book'),
        inArray(blobs.storageTier, ['remote', 'synced']),
      ),
    )
    .get()

  const cachedStats = db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(
      and(
        eq(blobs.kind, 'book'),
        eq(blobs.storageTier, 'synced'),
      ),
    )
    .get()

  const savedStats = db
    .select({
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(
      and(
        eq(blobs.kind, 'book'),
        eq(blobs.storageTier, 'remote'),
      ),
    )
    .get()

  let availableDiskBytes: number | undefined
  try {
    const stat = fsSync.statfsSync(config.dataDir)
    availableDiskBytes = stat.bavail * stat.bsize
  } catch {
    // Ignore if not supported on platform
  }

  const failedTransferStats = db
    .select({ count: sql<number>`count(*)` })
    .from(storageTransferTasks)
    .where(and(eq(storageTransferTasks.status, 'failed'), ne(storageTransferTasks.lastError, 'Migration paused by user')))
    .get()
  const failedTransferCount = failedTransferStats?.count ?? 0

  const localBlobsStats = db
    .select({
      bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
    })
    .from(blobs)
    .where(inArray(blobs.storageTier, ['local', 'synced']))
    .get()

  const fontStats = db
    .select({
      bytes: sql<number>`COALESCE(SUM(${fonts.size}), 0)`,
    })
    .from(fonts)
    .get()

  let dbBytes = 0
  try {
    if (fsSync.existsSync(config.dbPath)) {
      dbBytes += fsSync.statSync(config.dbPath).size
    }
    if (fsSync.existsSync(`${config.dbPath}-wal`)) {
      dbBytes += fsSync.statSync(`${config.dbPath}-wal`).size
    }
  } catch {
    // Ignore in-memory db or missing files
  }

  let snapshotsBytes = 0
  try {
    const snapDir = path.join(config.dataDir, 'snapshots')
    if (fsSync.existsSync(snapDir)) {
      for (const entry of fsSync.readdirSync(snapDir)) {
        snapshotsBytes += fsSync.statSync(path.join(snapDir, entry)).size
      }
    }
  } catch {
    // Ignore missing directory
  }

  const localTotalBytes = (localBlobsStats?.bytes ?? 0) + (fontStats?.bytes ?? 0) + dbBytes + snapshotsBytes

  return {
    enabled: inst.storageBackendEnabled,
    connectionId: inst.storageBackendConnectionId,
    connectionName,
    connectionEndpoint,
    basePath: inst.storageBackendBasePath,
    cacheMaxMb: inst.storageBackendCacheMaxMb,
    status: (inst.storageBackendStatus as 'active' | 'disabled' | 'error') || 'disabled',
    lastTestedAt: inst.storageBackendLastTestedAt ?? undefined,
    latencyMs: inst.storageBackendLatencyMs ?? undefined,
    totalBookCount: totalBookStats?.count ?? 0,
    totalBookBytes: totalBookStats?.bytes ?? 0,
    totalCoverBytes: totalCoverStats?.bytes ?? 0,
    remoteBookCount: remoteStats?.count ?? 0,
    remoteBytes: remoteStats?.bytes ?? 0,
    localCachedCount: cachedStats?.count ?? 0,
    localCachedBytes: cachedStats?.bytes ?? 0,
    savedDiskBytes: savedStats?.bytes ?? 0,
    localTotalBytes,
    availableDiskBytes,
    failedTransferCount,
  }
}

export async function testStorageBackend(body: TestStorageBackendReq): Promise<{ success: boolean; latencyMs: number }> {
  const db = getDb()
  const conn = db
    .select()
    .from(storageConnections)
    .where(eq(storageConnections.id, body.connectionId))
    .get()

  if (!conn) {
    throw new AppError('NOT_FOUND', 'Storage connection not found')
  }

  const client = buildProbeClient(conn)

  const res = await client.testStorageProbe(body.basePath)

  // Update last tested time on instance
  const inst = db.select({ id: instance.id }).from(instance).get()
  if (inst) {
    db.update(instance)
      .set({
        storageBackendLastTestedAt: Date.now(),
        storageBackendLatencyMs: res.latencyMs,
      })
      .where(eq(instance.id, inst.id))
      .run()
  }

  return res
}

export async function updateStorageBackend(body: UpdateStorageBackendReq): Promise<StorageBackendConfigRes> {
  const db = getDb()
  const inst = db.select().from(instance).get()
  if (!inst) {
    throw new AppError('NOT_FOUND', 'Instance settings not found')
  }

  const cleanBasePath = '/' + body.basePath.replace(/^\/+|\/+$/g, '')

  if (body.enabled && !body.connectionId) {
    throw new AppError('VALIDATION_ERROR', 'connectionId is required when storage backend is enabled')
  }

  // Guard 1: Switching from remote to local
  if (!body.enabled && inst.storageBackendEnabled) {
    const remoteOnlyStats = db
      .select({ count: sql<number>`count(*)` })
      .from(blobs)
      .where(and(eq(blobs.kind, 'book'), eq(blobs.storageTier, 'remote')))
      .get()

    if ((remoteOnlyStats?.count ?? 0) > 0) {
      throw new AppError(
        'STORAGE_RESTORE_REQUIRED',
        `Cannot switch to local storage: ${remoteOnlyStats?.count} books are only stored on remote. Please restore them to local disk first.`,
      )
    }
  }

  db.update(instance)
    .set({
      storageBackendEnabled: body.enabled,
      storageBackendConnectionId: body.connectionId,
      storageBackendBasePath: cleanBasePath,
      storageBackendCacheMaxMb: body.cacheMaxMb,
      storageBackendStatus: body.enabled ? 'active' : 'disabled',
      updatedAt: Date.now(),
    })
    .where(eq(instance.id, inst.id))
    .run()

  // Local books stay 'local' until the transfer worker confirms the remote
  // copy, then flips them to 'synced'. Never mark them synced here: a false
  // tier lets cache eviction delete the only copy.
  const targetChanged =
    inst.storageBackendConnectionId !== body.connectionId ||
    inst.storageBackendBasePath !== cleanBasePath
  if (targetChanged) {
    db.delete(storageTransferTasks)
      .where(eq(storageTransferTasks.taskType, 'migrate'))
      .run()
  }

  // Hot reset driver
  resetStorage()

  // Apply a lowered cache cap promptly without blocking the response.
  // Only synced copies (remote-backed) are evicted, so this is safe.
  if (body.enabled) {
    void triggerLruEviction(body.cacheMaxMb, new LocalFsDriver(path.join(config.dataDir, 'files')))
  }

  return getStorageBackendConfig()
}

export async function clearStorageBackendCache(): Promise<ClearStorageCacheRes> {
  const db = getDb()
  const cachedBlobs = db
    .select({ key: blobs.key, size: blobs.size })
    .from(blobs)
    .where(and(eq(blobs.kind, 'book'), eq(blobs.storageTier, 'synced')))
    .all()

  let freedBytes = 0
  let freedCount = 0
  for (const b of cachedBlobs) {
    const localPath = path.join(config.dataDir, 'files', b.key)
    try {
      await fs.unlink(localPath)
      db.update(blobs)
        .set({ storageTier: 'remote' })
        .where(eq(blobs.key, b.key))
        .run()
      freedBytes += b.size
      freedCount += 1
    } catch {}
  }

  return { success: true, freedBytes, freedCount }
}

export async function getStorageMigrationStatus(): Promise<StorageMigrationStatusRes> {
  const db = getDb()
  const migrationTasks = db
    .select()
    .from(storageTransferTasks)
    .where(eq(storageTransferTasks.taskType, 'migrate'))
    .all()

  const totalBooks = migrationTasks.length
  const completedTasks = migrationTasks.filter((t) => t.status === 'completed')
  const failedTasks = migrationTasks.filter((t) => t.status === 'failed')
  const runningTasks = migrationTasks.filter((t) => t.status === 'processing' || t.status === 'pending')

  let status: StorageMigrationStatusRes['status'] = 'idle'
  if (runningTasks.length > 0) {
    status = 'running'
  } else if (failedTasks.length > 0 && totalBooks > 0) {
    status = 'failed'
  } else if (completedTasks.length === totalBooks && totalBooks > 0) {
    status = 'completed'
  }

  // Calculate freed bytes from completed migration tasks
  let freedBytes = 0
  if (completedTasks.length > 0) {
    const keys = completedTasks.map((t) => t.blobKey)
    const sizeStats = db
      .select({ total: sql<number>`COALESCE(SUM(${blobs.size}), 0)` })
      .from(blobs)
      .where(inArray(blobs.key, keys))
      .get()
    freedBytes = sizeStats?.total ?? 0
  }

  const lastFailed = failedTasks[0]

  return {
    status,
    totalBooks,
    migratedBooks: completedTasks.length,
    freedBytes,
    lastError: lastFailed?.lastError ?? undefined,
  }
}

export async function startStorageMigration(): Promise<StorageMigrationStatusRes> {
  const db = getDb()
  // Reset any failed or zombie processing migrate tasks to pending
  db.update(storageTransferTasks)
    .set({ status: 'pending', attempts: 0, updatedAt: Date.now() })
    .where(and(
      eq(storageTransferTasks.taskType, 'migrate'),
      inArray(storageTransferTasks.status, ['failed', 'processing']),
    ))
    .run()

  // Enqueue any remaining local books
  const localBlobs = db
    .select({ key: blobs.key })
    .from(blobs)
    .where(and(eq(blobs.kind, 'book'), eq(blobs.storageTier, 'local')))
    .all()

  const now = Date.now()
  for (const b of localBlobs) {
    const existing = db
      .select({ id: storageTransferTasks.id })
      .from(storageTransferTasks)
      .where(and(eq(storageTransferTasks.blobKey, b.key), eq(storageTransferTasks.taskType, 'migrate')))
      .get()

    if (!existing) {
      db.insert(storageTransferTasks).values({
        id: createId('stask'),
        blobKey: b.key,
        taskType: 'migrate',
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
  }

  void triggerTransferWorker()
  return getStorageMigrationStatus()
}

export async function pauseStorageMigration(): Promise<StorageMigrationStatusRes> {
  const db = getDb()
  // Remove pending and processing tasks so migration halts immediately without ghost state
  db.delete(storageTransferTasks)
    .where(and(
      eq(storageTransferTasks.taskType, 'migrate'),
      inArray(storageTransferTasks.status, ['pending', 'processing']),
    ))
    .run()

  return getStorageMigrationStatus()
}

export async function inspectStorageTarget(
  body: InspectStorageTargetReq,
): Promise<StorageTargetInspectionRes> {
  const db = getDb()

  const totalStats = db
    .select({ count: sql<number>`count(*)` })
    .from(blobs)
    .where(eq(blobs.kind, 'book'))
    .get()
  const totalBooks = totalStats?.count ?? 0

  if (body.target === 'local') {
    const remoteOnlyStats = db
      .select({
        count: sql<number>`count(*)`,
        bytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)`,
      })
      .from(blobs)
      .where(and(eq(blobs.kind, 'book'), eq(blobs.storageTier, 'remote')))
      .get()

    const missingBooks = remoteOnlyStats?.count ?? 0
    const missingBytes = remoteOnlyStats?.bytes ?? 0
    const existingBooks = totalBooks - missingBooks
    const ready = missingBooks === 0

    return {
      target: 'local',
      ready,
      totalBooks,
      existingBooks,
      missingBooks,
      missingBytes,
      reason: ready ? 'ready' : 'missing_local_files',
      message: ready
        ? undefined
        : `检测到有 ${missingBooks} 本书籍仅保存在远端存储，切回本地前请先还原至本地服务器。`,
    }
  }

  // Target is remote
  if (!body.connectionId) {
    throw new AppError('VALIDATION_ERROR', 'connectionId is required for remote target inspection')
  }

  const conn = db
    .select()
    .from(storageConnections)
    .where(eq(storageConnections.id, body.connectionId))
    .get()

  if (!conn) {
    throw new AppError('STORAGE_CONNECTION_NOT_FOUND', 'Storage connection not found')
  }

  const cleanBase = '/' + (body.basePath || '/Bookdock/storage').replace(/^\/+|\/+$/g, '')
  const client = buildProbeClient(conn)

  // Get all book keys that exist in Bookdock
  const bookBlobs = db
    .select({ key: blobs.key, size: blobs.size })
    .from(blobs)
    .where(eq(blobs.kind, 'book'))
    .all()

  if (bookBlobs.length === 0) {
    return {
      target: 'remote',
      ready: true,
      totalBooks: 0,
      existingBooks: 0,
      missingBooks: 0,
      missingBytes: 0,
      reason: 'ready',
    }
  }

  let existingCount = 0
  let missingCount = 0
  let missingBytes = 0
  const existingKeys: string[] = []

  // Check in concurrent batches of 8 to complete within ~1 second instead of minutes
  const CONCURRENCY = 8
  for (let i = 0; i < bookBlobs.length; i += CONCURRENCY) {
    const chunk = bookBlobs.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (b) => {
        const remotePath = `${cleanBase}/${b.key.replace(/^\/+/, '')}`
        try {
          const exists = await client.exists(remotePath)
          if (exists) {
            existingCount++
            existingKeys.push(b.key)
          } else {
            missingCount++
            missingBytes += b.size
          }
        } catch {
          missingCount++
          missingBytes += b.size
        }
      }),
    )
  }

  // If this target is currently active, automatically reconcile existing books to synced
  const activeInst = db.select().from(instance).get()
  if (
    activeInst?.storageBackendEnabled &&
    activeInst.storageBackendConnectionId === body.connectionId &&
    existingKeys.length > 0
  ) {
    db.update(blobs)
      .set({ storageTier: 'synced', lastAccessedAt: Date.now() })
      .where(inArray(blobs.key, existingKeys))
      .run()
  }

  const ready = missingCount === 0
  return {
    target: 'remote',
    ready,
    totalBooks: bookBlobs.length,
    existingBooks: existingCount,
    missingBooks: missingCount,
    missingBytes,
    reason: ready ? 'ready' : 'missing_remote_files',
    message: ready
      ? undefined
      : `目标存储未检测到历史书籍文件。请先切换至本地将书籍下载完整，或在外部存储中将旧目录文件复制到新路径。`,
  }
}

export async function getStorageRestoreStatus(): Promise<StorageRestoreStatusRes> {
  const db = getDb()
  const restoreTasks = db
    .select()
    .from(storageTransferTasks)
    .where(eq(storageTransferTasks.taskType, 'restore'))
    .all()

  const totalBooks = restoreTasks.length
  const completedTasks = restoreTasks.filter((t) => t.status === 'completed')
  const failedTasks = restoreTasks.filter((t) => t.status === 'failed')
  const runningTasks = restoreTasks.filter((t) => t.status === 'processing' || t.status === 'pending')

  let status: StorageRestoreStatusRes['status'] = 'idle'
  if (runningTasks.length > 0) {
    status = 'running'
  } else if (failedTasks.length > 0 && totalBooks > 0) {
    status = 'failed'
  } else if (completedTasks.length === totalBooks && totalBooks > 0) {
    status = 'completed'
  }

  let restoredBytes = 0
  if (completedTasks.length > 0) {
    const keys = completedTasks.map((t) => t.blobKey)
    const sizeStats = db
      .select({ total: sql<number>`COALESCE(SUM(${blobs.size}), 0)` })
      .from(blobs)
      .where(inArray(blobs.key, keys))
      .get()
    restoredBytes = sizeStats?.total ?? 0
  }

  const lastFailed = failedTasks[0]

  return {
    status,
    totalBooks,
    restoredBooks: completedTasks.length,
    restoredBytes,
    lastError: lastFailed?.lastError ?? undefined,
  }
}

export async function startStorageRestore(): Promise<StorageRestoreStatusRes> {
  const db = getDb()
  // Reset any failed restore tasks to pending
  db.update(storageTransferTasks)
    .set({ status: 'pending', attempts: 0, updatedAt: Date.now() })
    .where(and(eq(storageTransferTasks.taskType, 'restore'), eq(storageTransferTasks.status, 'failed')))
    .run()

  // Enqueue any remote-only books
  const remoteBlobs = db
    .select({ key: blobs.key })
    .from(blobs)
    .where(and(eq(blobs.kind, 'book'), eq(blobs.storageTier, 'remote')))
    .all()

  const now = Date.now()
  for (const b of remoteBlobs) {
    const existing = db
      .select({ id: storageTransferTasks.id, status: storageTransferTasks.status })
      .from(storageTransferTasks)
      .where(and(eq(storageTransferTasks.blobKey, b.key), eq(storageTransferTasks.taskType, 'restore')))
      .get()

    if (!existing) {
      db.insert(storageTransferTasks).values({
        id: createId('stask'),
        blobKey: b.key,
        taskType: 'restore',
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }).run()
    } else if (existing.status !== 'completed' && existing.status !== 'processing') {
      db.update(storageTransferTasks)
        .set({ status: 'pending', attempts: 0, updatedAt: now })
        .where(eq(storageTransferTasks.id, existing.id))
        .run()
    }
  }

  void triggerTransferWorker()
  return getStorageRestoreStatus()
}

export async function pauseStorageRestore(): Promise<StorageRestoreStatusRes> {
  const db = getDb()
  db.delete(storageTransferTasks)
    .where(and(
      eq(storageTransferTasks.taskType, 'restore'),
      inArray(storageTransferTasks.status, ['pending', 'processing']),
    ))
    .run()

  return getStorageRestoreStatus()
}
