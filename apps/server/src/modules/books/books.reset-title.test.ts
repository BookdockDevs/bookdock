import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { resetBookMetadata, updateBook, uploadBook } from './books.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) {
        files.set(key, data)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key, range) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buf.subarray(range.start, range.end + 1) : buf)
    },
    async delete(key) {
      files.delete(key)
    },
    async exists(key) {
      return files.has(key)
    },
    async size(key) {
      return files.get(key)?.length ?? 0
    },
  }
  return { driver, files }
}

function seedUser(db: ReturnType<typeof createTestDb>, username: string): string {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username,
    passwordHash: null,
    role: 'owner',
    createdAt: Date.now(),
  }).run()
  return id
}

describe('resetBookMetadata metadata normalization', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let epubMeta: { title: string; author?: string } = { title: '' }

  beforeAll(() => {
    registerParser(new TxtParser())
    // Metadata-less EPUB parse: reset then falls back to meta.fileName, the
    // Keep the parser metadata mutable so reset tests can cover independent fields.
    registerParser({
      match: (fileName) => fileName.toLowerCase().endsWith('.epub'),
      parse: async () => ({ meta: epubMeta, chapters: [] }),
    })
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    epubMeta = { title: '' }
  })

  function junkFile() {
    return new File(['第一章\n正文内容'], '间客（精校版全本）作者：猫腻.txt', { type: 'text/plain' })
  }

  it('re-derives a normalized title from meta.fileName when enabled', async () => {
    const { book } = await uploadBook(ownerId, junkFile(), undefined, { normalizeTitle: false })
    await updateBook(ownerId, book.id, { title: '被改坏的名字' })

    const reset = await resetBookMetadata(ownerId, book.id, { normalizeTitle: true })
    expect(reset.title).toBe('间客')
    expect(reset.author).toBe('猫腻')
  })

  it('keeps the current title when disabled', async () => {
    const { book } = await uploadBook(ownerId, junkFile(), undefined, { normalizeTitle: false })
    await updateBook(ownerId, book.id, { title: '用户起的名字' })

    const reset = await resetBookMetadata(ownerId, book.id, { normalizeTitle: false })
    expect(reset.title).toBe('用户起的名字')
  })

  it('fills missing EPUB metadata fields independently from the file name', async () => {
    epubMeta = { title: '内置书名' }
    const file = new File(['epub content'], '文件名（精校版）作者：作者名.epub', { type: 'application/epub+zip' })

    const { book } = await uploadBook(ownerId, file, undefined, { normalizeTitle: true })

    expect(book.title).toBe('内置书名')
    expect(book.author).toBe('作者名')
  })

  it('uses the file name for missing EPUB title and author', async () => {
    const file = new File(['epub content'], '文件名（精校版）作者：作者名.epub', { type: 'application/epub+zip' })

    const { book } = await uploadBook(ownerId, file, undefined, { normalizeTitle: true })

    expect(book.title).toBe('文件名')
    expect(book.author).toBe('作者名')
  })
})
