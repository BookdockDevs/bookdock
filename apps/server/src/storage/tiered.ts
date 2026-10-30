import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { eq, sql } from 'drizzle-orm'

import type { StorageDriver } from './driver'
import { LocalFsDriver } from './localfs'
import type { RemoteTierClient } from '../lib/remote-client'
import { S3Client } from '../lib/s3'
import { WebDavClient } from '../lib/webdav'
import { config } from '../config'
import { getDb } from '../db/client'
import { blobs, instance, storageConnections, storageTransferTasks } from '../db/schema'
import { createId } from '../lib/id'
import { decryptPassword } from '../lib/secrets'

export class TieredStorageDriver implements StorageDriver {
  private localDriver: LocalFsDriver
  private remoteClient: RemoteTierClient | null = null
  private remoteBasePath: string = '/Bookdock/storage'
  private cacheMaxMb: number = 2048
  private cacheFills = new Map<string, Promise<void>>()
  private remoteSizes = new Map<string, { size: number; expires: number }>()
  private rangeRetryAt = new Map<string, number>()
  private metadataRetryAt = 0
  private cancelledFills = new Set<string>()

  constructor(client: RemoteTierClient, remoteBasePath: string, cacheMaxMb: number) {
    this.localDriver = new LocalFsDriver(path.join(config.dataDir, 'files'))
    this.remoteClient = client
    this.remoteBasePath = remoteBasePath
    this.cacheMaxMb = cacheMaxMb
  }

  getBaseDir(): string {
    return this.localDriver.getBaseDir()
  }

  private isLocalAsset(key: string): boolean {
    // Personal source packages are tiny local-only code artifacts; they have
    // no cold-data value and should never round-trip to the remote tier.
    return key.startsWith('covers/') || key.startsWith('cover/') || key.startsWith('content/') || key.startsWith('sources/')
  }

  private getRemoteFilePath(key: string): string {
    const cleanBase = '/' + this.remoteBasePath.replace(/^\/+|\/+$/g, '')
    const cleanKey = '/' + key.replace(/^\/+/, '')
    return cleanBase + cleanKey
  }

  async put(key: string, data: Buffer | Readable): Promise<void> {
    // Small permission-bound assets stay local and do not enter the book transfer queue.
    if (this.isLocalAsset(key)) {
      return this.localDriver.put(key, data)
    }

    // 1. Write to local staging first (guarantees instant upload response)
    await this.localDriver.put(key, data)

    // 2. Enqueue asynchronous transfer task
    try {
      const db = getDb()
      const now = Date.now()
      db.insert(storageTransferTasks).values({
        id: createId('stask'),
        blobKey: key,
        taskType: 'archive',
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }).run()

      // Update blob storageTier to 'local'
      db.update(blobs)
        .set({ storageTier: 'local', lastAccessedAt: now })
        .where(eq(blobs.key, key))
        .run()

      // Trigger transfer worker in background
      triggerTransferWorker()
    } catch {
      // Non-fatal if task scheduling fails (local file is safely present)
    }
  }

  async get(key: string, range?: { start: number; end: number }): Promise<Readable> {
    if (this.isLocalAsset(key) || !this.remoteClient) {
      return this.localDriver.get(key, range)
    }

    const localExists = await this.localDriver.exists(key)
    if (localExists) {
      // Touch lastAccessedAt for LRU tracking
      this.touchLastAccessed(key)
      return this.localDriver.get(key, range)
    }

    const rangeCooldown = this.rangeRetryAt.get(key) ?? 0
    if (range && !this.cacheFills.has(key) && this.remoteClient.getRange && Date.now() >= rangeCooldown) {
      const started = Date.now()
      try {
        const result = await this.remoteClient.getRange(this.getRemoteFilePath(key), range)
        if (result) {
          this.remoteSizes.set(key, { size: result.size, expires: Date.now() + 30000 })
          // Several tiny ZIP reads on a high-latency store can cost more than one
          // full download. Keep truly large files on the bounded Range path.
          const slowProbe = range.end - range.start < 65536 && Date.now() - started > 1500
            && result.size <= 32 * 1024 * 1024
          if (!slowProbe) return Readable.from([result.data])
        }
      } catch {
        // Transient failures also fall back to the shared full-file path.
      }
      this.rangeRetryAt.set(key, Date.now() + 30000)
    }

    await this.ensureCached(key)
    return this.localDriver.get(key, range)
  }

  private async ensureCached(key: string): Promise<void> {
    let fill = this.cacheFills.get(key)
    if (!fill) {
      fill = this.fillCache(key, this.remoteSizes.get(key)?.size).finally(() => this.cacheFills.delete(key))
      this.cacheFills.set(key, fill)
    }
    await fill
  }

  private async fillCache(key: string, expectedSize?: number): Promise<void> {
    const remotePath = this.getRemoteFilePath(key)
    const localTarget = path.join(config.dataDir, 'files', key)
    const tmpPath = localTarget + '.tmp.' + randomUUID()

    await fs.mkdir(path.dirname(localTarget), { recursive: true })

    try {
      const remoteStream = await this.remoteClient!.getStream(remotePath)
      await pipeline(remoteStream, fsSync.createWriteStream(tmpPath))

      const stat = await fs.stat(tmpPath)
      if (stat.size === 0 || (expectedSize !== undefined && stat.size !== expectedSize)) {
        throw new Error('Downloaded cache file has an unexpected size')
      }

      if (this.cancelledFills.has(key)) {
        await fs.unlink(tmpPath).catch(() => {})
        return
      }

      await fs.rename(tmpPath, localTarget)

      // Update DB status to synced
      try {
        const db = getDb()
        db.update(blobs)
          .set({ storageTier: 'synced', lastAccessedAt: Date.now() })
          .where(eq(blobs.key, key))
          .run()
      } catch {}

      // Trigger LRU eviction check asynchronously
      triggerLruEviction(this.cacheMaxMb, this.localDriver)

      this.remoteSizes.delete(key)
    } catch (err) {
      this.remoteSizes.delete(key)
      await fs.unlink(tmpPath).catch(() => {})
      throw err
    } finally {
      this.cancelledFills.delete(key)
    }
  }

  async delete(key: string): Promise<void> {
    if (this.cacheFills.has(key)) {
      this.cancelledFills.add(key)
    }
    if (key.startsWith('content/')) {
      await this.localDriver.delete(key)
      return
    }
    // 1. Delete local copy
    await this.localDriver.delete(key).catch(() => {})

    // 2. Delete remote copy if not cover
    if (!this.isLocalAsset(key) && this.remoteClient) {
      const remotePath = this.getRemoteFilePath(key)
      await this.remoteClient.delete(remotePath).catch(() => {})
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.isLocalAsset(key)) {
      return this.localDriver.exists(key)
    }

    // Instant local check
    if (await this.localDriver.exists(key)) {
      return true
    }

    // DB tier is the source of truth for gating reads: get() will download
    // from remote on a miss and throw if the copy is truly gone. Do not
    // gate on a live remote probe here — remote listing calls are flaky enough
    // (short timeouts, non-standard statuses) that a false negative would
    // turn an openable book into BOOK_FILE_MISSING.
    try {
      const db = getDb()
      const row = db.select({ tier: blobs.storageTier }).from(blobs).where(eq(blobs.key, key)).get()
      if (row && (row.tier === 'synced' || row.tier === 'remote')) {
        return true
      }
    } catch {}

    // Fallback probe for rows the DB does not know about
    if (this.remoteClient) {
      return this.remoteClient.exists(this.getRemoteFilePath(key))
    }
    return false
  }

  async size(key: string): Promise<number> {
    if (this.isLocalAsset(key)) {
      return this.localDriver.size(key)
    }

    if (await this.localDriver.exists(key)) {
      return this.localDriver.size(key)
    }

    if (this.remoteClient) {
      const cached = this.remoteSizes.get(key)
      if (cached && cached.expires > Date.now()) return cached.size
      if (Date.now() < this.metadataRetryAt) {
        await this.ensureCached(key)
        return this.localDriver.size(key)
      }
      let size: number
      try {
        size = await this.remoteClient.size(this.getRemoteFilePath(key))
        if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid remote file size')
      } catch {
        // A failed HEAD/PROPFIND must not make a readable remote book unavailable.
        this.metadataRetryAt = Date.now() + 60000
        await this.ensureCached(key)
        return this.localDriver.size(key)
      }
      if (this.remoteSizes.size >= 256) this.remoteSizes.clear()
      this.remoteSizes.set(key, { size, expires: Date.now() + 30000 })
      return size
    }
    return 0
  }

  private touchLastAccessed(key: string): void {
    try {
      const db = getDb()
      db.update(blobs)
        .set({ lastAccessedAt: Date.now() })
        .where(eq(blobs.key, key))
        .run()
    } catch {}
  }
}

// Helper to construct TieredStorageDriver from instance settings
export interface StoredRemoteConnection {
  provider: string
  endpoint: string
  username: string
  encryptedPassword: string | null
  region: string | null
  bucket: string | null
}

export function buildRemoteClientForConnection(
  conn: StoredRemoteConnection,
  basePath = '/',
): RemoteTierClient {
  const password = conn.encryptedPassword ? (decryptPassword(conn.encryptedPassword) || undefined) : undefined
  if (conn.provider === 's3') {
    return new S3Client({
      endpoint: conn.endpoint,
      region: conn.region || undefined,
      bucket: conn.bucket || '',
      accessKey: conn.username,
      secretKey: password,
      basePath,
    })
  }
  return new WebDavClient({
    url: conn.endpoint,
    username: conn.username,
    password,
    basePath,
  })
}

export function createTieredDriverFromDb(): TieredStorageDriver | null {
  try {
    const db = getDb()
    const inst = db.select().from(instance).get()
    if (!inst?.storageBackendEnabled || !inst.storageBackendConnectionId) {
      return null
    }

    const conn = db
      .select()
      .from(storageConnections)
      .where(eq(storageConnections.id, inst.storageBackendConnectionId))
      .get()

    if (!conn) return null

    const client = buildRemoteClientForConnection(conn, '/')

    return new TieredStorageDriver(client, inst.storageBackendBasePath, inst.storageBackendCacheMaxMb)
  } catch {
    return null
  }
}

// In-memory worker lock to prevent overlapping runs
let _isWorkerRunning = false

// Self-healing: recover zombie processing tasks back to pending on startup or worker init
export function recoverZombieTransferTasks(): void {
  try {
    const db = getDb()
    db.update(storageTransferTasks)
      .set({ status: 'pending', updatedAt: Date.now() })
      .where(eq(storageTransferTasks.status, 'processing'))
      .run()
    void triggerTransferWorker()
  } catch {}
}

export async function triggerTransferWorker(): Promise<void> {
  if (_isWorkerRunning) return
  _isWorkerRunning = true

  try {
    const db = getDb()

    // Self-healing: recover zombie processing tasks back to pending
    db.update(storageTransferTasks)
      .set({ status: 'pending', updatedAt: Date.now() })
      .where(eq(storageTransferTasks.status, 'processing'))
      .run()

    const inst = db.select().from(instance).get()
    if (!inst?.storageBackendEnabled || !inst.storageBackendConnectionId) {
      _isWorkerRunning = false
      return
    }

    const conn = db
      .select()
      .from(storageConnections)
      .where(eq(storageConnections.id, inst.storageBackendConnectionId))
      .get()
    if (!conn) {
      _isWorkerRunning = false
      return
    }

    const client = buildRemoteClientForConnection(conn, '/')

    const cleanBase = '/' + inst.storageBackendBasePath.replace(/^\/+|\/+$/g, '')

    while (true) {
      const task = db
        .select()
        .from(storageTransferTasks)
        .where(eq(storageTransferTasks.status, 'pending'))
        .limit(1)
        .get()

      if (!task) break

      db.update(storageTransferTasks)
        .set({ status: 'processing', updatedAt: Date.now() })
        .where(eq(storageTransferTasks.id, task.id))
        .run()

      const localPath = path.join(config.dataDir, 'files', task.blobKey)
      const remoteFilePath = `${cleanBase}/${task.blobKey.replace(/^\/+/, '')}`

      try {
        if (task.taskType === 'restore') {
          // Restore task: download from remote storage into local files
          const localExists = await fs.stat(localPath).then((st) => st.size > 0).catch(() => false)
          if (!localExists) {
            await fs.mkdir(path.dirname(localPath), { recursive: true })
            const tmpPath = localPath + '.tmp.' + randomUUID()

            const remoteStream = await client.getStream(remoteFilePath)
            await pipeline(remoteStream, fsSync.createWriteStream(tmpPath))

            const stat = await fs.stat(tmpPath)
            if (stat.size === 0) {
              throw new Error('Restored file is empty')
            }

            await fs.rename(tmpPath, localPath)
          }

          // Mark task completed
          db.update(storageTransferTasks)
            .set({ status: 'completed', updatedAt: Date.now() })
            .where(eq(storageTransferTasks.id, task.id))
            .run()

          // Mark blob as synced (available locally on server disk)
          db.update(blobs)
            .set({ storageTier: 'synced', lastAccessedAt: Date.now() })
            .where(eq(blobs.key, task.blobKey))
            .run()
        } else {
          // Ensure remote parent directories exist
          await client.mkdir(path.dirname(remoteFilePath))

          // Skip uploading if remote already exists with valid content
          const remoteExists = await client.exists(remoteFilePath).catch(() => false)
          if (!remoteExists) {
            // Stream local file to remote storage without buffering whole file into RAM
            const fileStream = fsSync.createReadStream(localPath)
            await client.upload(remoteFilePath, fileStream)
          }

          // Mark task completed
          db.update(storageTransferTasks)
            .set({ status: 'completed', updatedAt: Date.now() })
            .where(eq(storageTransferTasks.id, task.id))
            .run()

          // Keep blob as synced in local cache (already on disk, no need to re-download on first read)
          db.update(blobs)
            .set({ storageTier: 'synced', lastAccessedAt: Date.now() })
            .where(eq(blobs.key, task.blobKey))
            .run()

          // Enforce LRU eviction: evict oldest only if cache quota is exceeded
          const cacheMaxMb = inst.storageBackendCacheMaxMb ?? 2048
          const driver = new LocalFsDriver(path.join(config.dataDir, 'files'))
          void triggerLruEviction(cacheMaxMb, driver)
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const isFatalError =
          errorMsg.includes('401') ||
          errorMsg.includes('403') ||
          errorMsg.includes('507') ||
          errorMsg.includes('Account lacks permission')
        const nextAttempts = isFatalError ? 5 : task.attempts + 1
        const newStatus = nextAttempts >= 5 ? 'failed' : 'pending'

        db.update(storageTransferTasks)
          .set({
            status: newStatus,
            attempts: nextAttempts,
            lastError: errorMsg,
            updatedAt: Date.now(),
          })
          .where(eq(storageTransferTasks.id, task.id))
          .run()

        // Leave retryable tasks pending but break this round so a persistent
        // network/auth failure does not hammer remote storage with tight retries.
        // The next triggerTransferWorker() call resumes them.
        if (newStatus === 'pending') break
      }
    }
  } catch {
    // Ignore worker failure
  } finally {
    _isWorkerRunning = false
  }
}

// LRU Eviction: ensures server disk cache does not exceed cacheMaxMb
let _isEvicting = false
export async function triggerLruEviction(cacheMaxMb: number, localDriver: LocalFsDriver): Promise<void> {
  if (_isEvicting) return
  _isEvicting = true

  try {
    const db = getDb()
    const maxBytes = cacheMaxMb * 1024 * 1024
    const targetBytes = maxBytes * 0.9 // Target 90% to avoid thrashing

    // Calculate current cached book bytes
    const cachedStats = db
      .select({ totalBytes: sql<number>`COALESCE(SUM(${blobs.size}), 0)` })
      .from(blobs)
      .where(sql`${blobs.kind} = 'book' AND ${blobs.storageTier} = 'synced'`)
      .get()

    let currentBytes = cachedStats?.totalBytes ?? 0
    if (currentBytes <= maxBytes) {
      _isEvicting = false
      return
    }

    // Fetch candidate synced blobs sorted by oldest accessed first
    const candidates = db
      .select({ key: blobs.key, size: blobs.size })
      .from(blobs)
      .where(sql`${blobs.kind} = 'book' AND ${blobs.storageTier} = 'synced'`)
      .orderBy(sql`COALESCE(${blobs.lastAccessedAt}, ${blobs.createdAt}) ASC`)
      .all()

    for (const item of candidates) {
      if (currentBytes <= targetBytes) break

      try {
        await localDriver.delete(item.key)
        db.update(blobs)
          .set({ storageTier: 'remote' })
          .where(eq(blobs.key, item.key))
          .run()
        currentBytes -= item.size
      } catch {}
    }
  } catch {
  } finally {
    _isEvicting = false
  }
}
