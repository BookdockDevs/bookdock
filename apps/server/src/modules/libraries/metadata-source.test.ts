import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import { and, eq } from 'drizzle-orm'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from '../../db/client'
import * as schema from '../../db/legacy-test-schema'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { updateBook, uploadBook, uploadCatalogBook } from '../books/books.service'
import { getPrivateBookMetadataSource, getCatalogVersionFileSource } from './metadata-source.service'
import { addToPrivateLibrary } from './collect.service'
import { updateCatalogVersion, getCatalogBook } from './catalog.service'

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
      if (Buffer.isBuffer(data)) files.set(key, data)
      else {
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
    async delete(key) { files.delete(key) },
    async exists(key) { return files.has(key) },
    async size(key) { return files.get(key)?.length ?? 0 },
  }
  return { driver, files }
}

function seedUser(db: ReturnType<typeof createTestDb>, username: string, role: 'owner' | 'member' = 'owner'): string {
  const id = createId('user')
  db.insert(schema.users).values({ id, username, passwordHash: null, role, createdAt: 1 }).run()
  db.insert(schema.libraries).values({
    id: createId('lib'), userId: id, type: 'private', name: username,
    description: '', visibility: null, createdAt: 1, updatedAt: 1,
  }).run()
  return id
}

let epubParse = { title: 'File Title', authors: ['File Author'], bookmeta: { publisher: 'File Press', language: 'en', seriesIndex: 2, series: 'File Series' } as Record<string, unknown> }

describe('metadata source (draft-only restore)', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeAll(() => {
    registerParser(new TxtParser())
    registerParser({
      match: (fileName) => fileName.toLowerCase().endsWith('.epub'),
      parse: async () => ({ meta: { title: epubParse.title, authors: epubParse.authors, bookmeta: epubParse.bookmeta }, chapters: [] }),
    })
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    epubParse = { title: 'File Title', authors: ['File Author'], bookmeta: { publisher: 'File Press', language: 'en', seriesIndex: 2, series: 'File Series' } }
  })

  it('reads EPUB file values without writing revisions or pins', async () => {
    const file = new File(['epub'], 'book.epub', { type: 'application/epub+zip' })
    const { book } = await uploadBook(ownerId, file, undefined, { normalizeTitle: true })
    await updateBook(ownerId, book.id, { title: 'Edited', bookmeta: { publisher: 'Edited Press' } })
    const before = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, book.id)).all()

    const source = await getPrivateBookMetadataSource(ownerId, book.id)
    expect(source.kind).toBe('file')
    if (source.kind !== 'file') return
    expect(source.values.title).toBe('File Title')
    expect(source.values.publisher).toBe('File Press')
    expect(source.provenance.title).toBe('file')

    const after = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, book.id)).all()
    expect(after).toHaveLength(before.length)
    expect(after[0]!.blobKey).toBe(before[0]!.blobKey)
  })

  it('falls back to filename only when enabled and marks provenance', async () => {
    epubParse = { title: '', authors: [], bookmeta: {} }
    const file = new File(['epub'], '文件名（精校版）作者：作者名.epub', { type: 'application/epub+zip' })
    const { book } = await uploadBook(ownerId, file, undefined, { normalizeTitle: false })

    db.update(schema.settings).set({ value: { normalizeTitle: true } }).where(and(eq(schema.settings.userId, ownerId), eq(schema.settings.key, 'library'))).run()
    db.insert(schema.settings).values({ id: createId('s'), userId: ownerId, key: 'library', value: { normalizeTitle: true } }).onConflictDoNothing().run()

    const source = await getPrivateBookMetadataSource(ownerId, book.id)
    expect(source.kind).toBe('file')
    if (source.kind !== 'file') return
    expect(source.values.title).toBe('文件名')
    expect(source.provenance.title).toBe('filename')
    expect(source.normalizeTitleApplied).toBe(true)
  })

  it('treats TXT generated defaults as missing and keeps filename inference', async () => {
    const file = new File(['第一章\n正文'], '间客 作者：猫腻.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file, undefined, { normalizeTitle: true })
    const source = await getPrivateBookMetadataSource(ownerId, book.id)
    expect(source.kind).toBe('file')
    if (source.kind !== 'file') return
    expect(source.format).toBe('txt')
    expect(source.values.title).toBe('间客')
    expect(source.values.publisher).toBeNull()
    expect(source.values.language).toBeNull()
    expect(source.values.isbn).toBeNull()
  })


  it('rejects missing TXT storage instead of returning an empty reset source', async () => {
    const { book } = await uploadBook(ownerId, new File(['第一章\n正文'], 'book.txt', { type: 'text/plain' }))
    await storage.getStorage().delete(book.filePath)
    await expect(getPrivateBookMetadataSource(ownerId, book.id)).rejects.toMatchObject({ code: 'BOOK_FILE_MISSING' })
  })

  it('rejects a collected source after membership revocation without mutating the card', async () => {
    const memberId = seedUser(db, 'revoked', 'member')
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({ id: libraryId, userId: ownerId, type: 'shared', name: 'Private', description: '', visibility: 'private', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryMemberships).values({ id: createId('member'), libraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1 }).run()
    const created = await uploadCatalogBook(libraryId, ownerId, new File(['a'], 'a.epub', { type: 'application/epub+zip' }), { title: 'Source' })
    const collected = await addToPrivateLibrary(memberId, libraryId, created.versionLinkId!)
    expect((await getPrivateBookMetadataSource(memberId, collected.bookVersionId)).kind).toBe('shared')
    const cards = db.select().from(schema.libraryBooks).all()
    const links = db.select().from(schema.libraryBookVersions).all()
    const revisions = db.select().from(schema.contentRevisions).all()
    db.delete(schema.libraryMemberships).where(eq(schema.libraryMemberships.userId, memberId)).run()
    await expect(getPrivateBookMetadataSource(memberId, collected.bookVersionId)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    expect(db.select().from(schema.libraryBooks).all()).toEqual(cards)
    expect(db.select().from(schema.libraryBookVersions).all()).toEqual(links)
    expect(db.select().from(schema.contentRevisions).all()).toEqual(revisions)
  })

  it('returns the exact bound shared version for a B and nothing else', async () => {
    const memberId = seedUser(db, 'member', 'member')
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const library = { id: libraryId }
    const first = await uploadCatalogBook(library.id, ownerId, new File(['a'], 'a.epub', { type: 'application/epub+zip' }), { title: 'Work', author: 'W' })
    const second = await uploadCatalogBook(library.id, ownerId, new File(['b'], 'b.epub', { type: 'application/epub+zip' }), { libraryBookId: first.libraryBookId, title: 'Work', author: 'W', name: 'v2' })
    await updateCatalogVersion(ownerId, library.id, first.libraryBookId, second.versionLinkId!, { title: 'Second Edition Title' })
    const collected = await addToPrivateLibrary(memberId, library.id, second.versionLinkId!)
    await updateBook(memberId, collected.bookVersionId, { title: 'My Title' })

    const source = await getPrivateBookMetadataSource(memberId, collected.bookVersionId)
    expect(source.kind).toBe('shared')
    if (source.kind !== 'shared') return
    expect(source.sourceLibraryBookVersionId).toBe(second.versionLinkId)
    expect(source.values.title).toBe('Second Edition Title')
    expect('description' in source.values).toBe(false)
  })

  it('rejects an unreadable shared source without leaking content', async () => {
    const memberId = seedUser(db, 'member2', 'member')
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'Private City',
      description: '', visibility: 'private', createdAt: 1, updatedAt: 1,
    }).run()
    const library = { id: libraryId }
    const created = await uploadCatalogBook(library.id, ownerId, new File(['a'], 'a.epub', { type: 'application/epub+zip' }), { title: 'Secret', author: 'W' })
    const collected = await addToPrivateLibrary(ownerId, library.id, created.versionLinkId!)
    void collected
    await expect(getPrivateBookMetadataSource(memberId, created.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('gates catalog version file source behind metadata management, not content contribution', async () => {
    const memberId = seedUser(db, 'contrib', 'member')
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City2',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const library = { id: libraryId }
    const created = await uploadCatalogBook(library.id, ownerId, new File(['a'], 'a.epub', { type: 'application/epub+zip' }), { title: 'Work', author: 'W' })
    await expect(getCatalogVersionFileSource(memberId, library.id, created.libraryBookId, created.versionLinkId!)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const source = await getCatalogVersionFileSource(ownerId, library.id, created.libraryBookId, created.versionLinkId!)
    expect(source.kind).toBe('file')
    const revisions = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
    expect(revisions).toHaveLength(1)
    const work = await getCatalogBook(ownerId, library.id, created.libraryBookId)
    expect(work.versions[0]!.meta).toEqual({})
  })
})
