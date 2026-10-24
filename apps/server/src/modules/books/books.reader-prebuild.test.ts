import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { createId } from '../../lib/id'
import type { StorageDriver } from '../../storage/driver'
import { appendTxtBookContent, getBook, reTocBook, uploadBook } from './books.service'

const { enqueueMock, testDataDir, storageState } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  testDataDir: `${process.cwd()}\\.tmp-reader-prebuild-writer-${process.pid}-${Date.now()}`,
  storageState: { files: new Map<string, Buffer>(), failSourceReads: false },
}))

vi.mock('../../config', () => ({ config: { dataDir: testDataDir, storageDriver: 'localfs' } }))
vi.mock('../../storage', () => ({
  getStorage: () => ({
    async put(key: string, data: Buffer | Readable) {
      if (Buffer.isBuffer(data)) storageState.files.set(key, data)
      else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        storageState.files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key: string, range?: { start: number; end: number }) {
      const value = storageState.files.get(key)
      if (!value) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? value.subarray(range.start, range.end + 1) : value)
    },
    async delete(key: string) { storageState.files.delete(key) },
    async exists(key: string) { return !storageState.failSourceReads && storageState.files.has(key) },
    async size(key: string) { return storageState.files.get(key)?.length ?? 0 },
  } satisfies StorageDriver),
}))
vi.mock('./reader-content.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reader-content.service')>()),
  enqueueReaderArchivePreparation: enqueueMock,
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, [
    '0041_idea_discussion', '0042_storage_connections', '0043_storage_backend', '0044_storage_s3',
    '0046_book_reviews', '0048_content_files', '0049_review_title', '0050_content_file_order',
    '0051_book_state_progress', '0052_reading_ledger', '0053_personal_archive',
  ])
  return db
}

describe('published reader source prebuild triggers', () => {
  beforeEach(() => {
    enqueueMock.mockReset()
    storageState.files.clear()
    storageState.failSourceReads = false
    const db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: 'owner', passwordHash: null, role: 'owner', createdAt: Date.now() }).run()
    testState.userId = userId
    registerParser(new TxtParser())
  })

  const testState: { userId?: string } = {}

  afterAll(async () => {
    vi.restoreAllMocks()
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  it('enqueues only committed sources and uses the final generated EPUB for TXT upload and append', async () => {
    const userId = testState.userId!
    const failedUpload = uploadBook(userId, new File(['unpublished'], 'failed.txt', { type: 'text/plain' }), { shelfId: 'missing-shelf' })
    await expect(failedUpload).rejects.toMatchObject({ code: 'SHELF_NOT_FOUND' })
    expect(enqueueMock).not.toHaveBeenCalled()

    const readerService = await vi.importActual<typeof import('./reader-content.service')>('./reader-content.service')
    let releasePrebuild!: () => void
    let notifyPrebuildStarted!: () => void
    const prebuildGate = new Promise<void>((resolve) => { releasePrebuild = resolve })
    const prebuildStarted = new Promise<void>((resolve) => { notifyPrebuildStarted = resolve })
    readerService.setReaderPrebuildGateForTests(async () => {
      notifyPrebuildStarted()
      await prebuildGate
    })
    enqueueMock.mockImplementation((source) => readerService.enqueueReaderArchivePreparation(source))
    const { book } = await uploadBook(userId, new File(['【第一部】\n\n正文一\n\n§ 1 开启\n\n正文二'], 'book.txt', { type: 'text/plain' }))
    await prebuildStarted
    storageState.failSourceReads = true
    releasePrebuild()
    await readerService.waitForReaderPrebuildsForTests()
    expect(book.filePath).toBeTruthy()
    storageState.failSourceReads = false
    readerService.setReaderPrebuildGateForTests(null)

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const uploadSource = enqueueMock.mock.calls[0]![0] as {
      id: string; filePath: string; format: string; revisionId: string; contentHash: string; size: number
    }
    expect(uploadSource).toMatchObject({
      id: book.id,
      filePath: book.filePath,
      format: 'txt',
      revisionId: book.revisionId,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      size: book.size,
    })
    const firstArtifact = storageState.files.get(uploadSource.filePath)!
    expect(firstArtifact.subarray(0, 2).toString()).toBe('PK')
    expect(uploadSource.contentHash).toBe(path.basename(uploadSource.filePath).replace('.epub', ''))

    enqueueMock.mockClear()
    await reTocBook(userId, book.id, null, [
      { level: 1, regex: '^【.+】$', replacement: null, enabled: true },
      { level: 2, regex: '^§\\s*\\d+.*$', replacement: null, enabled: true },
    ])
    const retocBook = await getBook(userId, book.id)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({
      id: book.id,
      filePath: retocBook.filePath,
      format: 'txt',
      revisionId: retocBook.revisionId,
      size: retocBook.size,
    })

    enqueueMock.mockClear()
    await appendTxtBookContent(userId, book.id, '\n第二章\n续写正文')
    const updated = await getBook(userId, book.id)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const appendSource = enqueueMock.mock.calls[0]![0] as typeof uploadSource
    expect(appendSource).toMatchObject({
      id: book.id,
      filePath: updated.filePath,
      format: 'txt',
      revisionId: updated.revisionId,
      size: updated.size,
    })
    expect(storageState.files.get(appendSource.filePath)?.subarray(0, 2).toString()).toBe('PK')
    await readerService.waitForReaderPrebuildsForTests()
    await readerService.waitForReaderDerivedWritesForTests()
  })
})
