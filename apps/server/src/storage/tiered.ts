import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { eq, sql } from 'drizzle-orm'

import type { StorageDriver } from './driver'
import { LocalFsDriver } from './localfs'
import { WebDavClient } from '../lib/webdav'
import { config } from '../config'
import { getDb } from '../db/client'
import { blobs, instance, storageConnections, storageTransferTasks } from '../db/schema'
import { createId } from '../lib/id'
import { decryptPassword } from '../lib/secrets'

export class TieredStorageDriver implements StorageDriver {
  private localDriver: LocalFsDriver
  private webdavClient: WebDavClient | null = null
  private remoteBasePath: string = '/Bookdock/storage'
  private cacheMaxMb: number = 2048

  constructor(client: WebDavClient, remoteBasePath: string, cacheMaxMb: number) {
    this.localDriver = new LocalFsDriver(path.join(config.dataDir, 'files'))
    this.webdavClient = client
    this.remoteBasePath = remoteBasePath
    this.cacheMaxMb = cacheMaxMb
  }

  private isCover(key: string): boolean {
    return key.startsWith('covers/') || key.startsWith('cover/')
  }

  private getRemoteFilePath(key: string): string {
    const cleanBase = '/' + this.remoteBasePath.replace(/^\/+|\/+$/g, '')
    const cleanKey = '/' + key.replace(/^\/+/, '')
    return cleanBase + cleanKey
  }

  async put(key: string, data: Buffer | Readable): Promise<void> {
    // Decision 1A: covers stay strictly local (never remote, zero network latency)
    if (this.isCover(key)) {
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
    if (this.isCover(key) || !this.webdavClient) {
      return this.localDriver.get(key, range)
    }

    const localExists = await this.localDriver.exists(key)
    if (localExists) {
      // Touch lastAccessedAt for LRU tracking
      this.touchLastAccessed(key)
      return this.localDriver.get(key, range)
    }

    // Cache Miss: stream from WebDAV into local cache via safe atomic pipeline (borrowed from ANX Reader)
    const remotePath = this.getRemoteFilePath(key)
    const localTarget = path.join(config.dataDir, 'files', key)
    const tmpPath = localTarget + '.tmp.' + randomUUID()

    await fs.mkdir(path.dirname(localTarget), { recursive: true })

    try {
      const remoteStream = await this.webdavClient.getStream(remotePath)
      await pipeline(remoteStream, fsSync.createWriteStream(tmpPath))

      const stat = await fs.stat(tmpPath)
      if (stat.size === 0) {
        throw new Error('Downloaded cache file is empty')
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

      return this.localDriver.get(key, range)
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    // 1. Delete local copy
    await this.localDriver.delete(key).catch(() => {})

    // 2. Delete remote copy if not cover
    if (!this.isCover(key) && this.webdavClient) {
      const remotePath = this.getRemoteFilePath(key)
      await this.webdavClient.delete(remotePath).catch(() => {})
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.isCover(key)) {
      return this.localDriver.exists(key)
    }

    // Instant local check
    if (await this.localDriver.exists(key)) {
      return true
    }

    // DB tier is the source of truth for gating reads: get() will download
    // from remote on a miss and throw if the copy is truly gone. Do not
    // gate on a live remote probe here — WebDAV PROPFIND is flaky enough
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
    if (this.webdavClient) {
      return this.webdavClient.exists(this.getRemoteFilePath(key))
    }
    return false
  }

  async size(key: string): Promise<number> {
    if (this.isCover(key)) {
      return this.localDriver.size(key)
    }

    // Fast DB check
    try {
      const db = getDb()
      const row = db.select({ size: blobs.size }).from(blobs).where(eq(blobs.key, key)).get()
      if (row?.size != null) {
        return row.size
      }
    } catch {}

    if (await this.localDriver.exists(key)) {
      return this.localDriver.size(key)
    }

    if (this.webdavClient) {
      return this.webdavClient.size(this.getRemoteFilePath(key))
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

    const password = conn.encryptedPassword ? (decryptPassword(conn.encryptedPassword) || undefined) : undefined
    const client = new WebDavClient({
      url: conn.endpoint,
      username: conn.username,
      password,
      basePath: '/',
    })

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

    const password = conn.encryptedPassword ? (decryptPassword(conn.encryptedPassword) || undefined) : undefined
    const client = new WebDavClient({
      url: conn.endpoint,
      username: conn.username,
      password,
      basePath: '/',
    })

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
          // Restore task: download from remote WebDAV into local files
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
            // Stream local file to WebDAV without buffering whole file into RAM
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
        // network/auth failure does not hammer WebDAV with tight retries.
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
