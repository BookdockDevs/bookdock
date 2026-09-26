import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { retargetBookIdReferences } from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { errorHandler } from '../../middleware/error'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import booksRoutes from './books.routes'
import { uploadBook } from './books.service'
import { createReplacement } from '../replacements/replacements.service'
import {
  assembleTxt,
  applyChapterReplacements,
  exportEpubBook,
  exportTxtBook,
  extractChapterRuns,
  unescapeXml,
  type ExportRule,
} from './txt-export'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  // Same composition as production runMigrations(): structural repairs that
  // cannot run inside the migrator transaction live here.
  retargetBookIdReferences(db)
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
    async get(key) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(buf)
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

function seedBook(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  overrides?: Partial<typeof schema.books.$inferInsert>,
) {
  const book = {
    id: createId('book'),
    userId,
    title: 'Test Book',
    author: 'Test Author',
    format: 'txt' as const,
    filePath: `blobs/te/${createId('hash')}.epub`,
    coverKey: null,
    size: 100,
    meta: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
  db.insert(schema.books).values(book).run()
  // New-model mirror for rewired reads: versions reuse the book id.
  let library = db.select({ id: schema.libraries.id }).from(schema.libraries)
    .where(and(eq(schema.libraries.userId, userId), eq(schema.libraries.type, 'private'))).get()
  if (!library) {
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId, type: 'private', name: userId,
      description: '', visibility: null, createdAt: book.createdAt, updatedAt: book.updatedAt,
    }).run()
    library = { id: libraryId }
  }
  const meta = (book.meta ?? {}) as Record<string, unknown>
  const chapters = Array.isArray(meta.chapters) ? meta.chapters : []
  const libraryBookId = createId('lb')
  db.insert(schema.bookVersions).values({
    id: book.id, format: book.format, size: book.size, createdAt: book.createdAt, updatedAt: book.updatedAt,
  }).run()
  db.insert(schema.contentRevisions).values({
    id: createId('rev'), bookVersionId: book.id, revisionNo: 1, blobKey: book.filePath,
    size: book.size, wordCount: typeof meta.wordCount === 'number' ? meta.wordCount : null,
    chapterCount: chapters.length, meta, createdAt: book.createdAt,
  }).run()
  db.insert(schema.libraryBooks).values({
    id: libraryBookId, libraryId: library.id, userId,
    title: book.title, author: book.author, createdAt: book.createdAt, updatedAt: book.updatedAt,
  }).run()
  db.insert(schema.libraryBookVersions).values({
    id: createId('lbv'), libraryId: library.id, libraryBookId, bookVersionId: book.id,
    kind: 'personal', createdAt: book.createdAt, updatedAt: book.updatedAt,
  }).run()
  return book
}

const rule = (overrides: Partial<ExportRule> = {}): ExportRule => ({
  id: 'r1',
  matchType: 'pattern',
  pattern: 'foo',
  replacement: 'bar',
  isRegex: false,
  applyTo: 'content',
  effectiveEnabled: true,
  spineHref: null,
  textOffset: null,
  originalText: null,
  ...overrides,
})

describe('txt export engine', () => {
  it('unescapes the five XML entities the generator emits', () => {
    expect(unescapeXml('a&amp;b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe('a&b <c> "d" \'e\'')
  })

  it('extracts the title and paragraph runs, skipping empty <p /> placeholders', () => {
    const xhtml = `<html><body><h1>第1章</h1>\n<p>第一段</p>\n<p />\n<p>第二段 &amp; 内容</p></body></html>`
    expect(extractChapterRuns(xhtml)).toEqual({
      title: '第1章',
      paragraphs: ['第一段', '第二段 & 内容'],
    })
  })

  it('applies content rules without touching the title', () => {
    const runs = [{ text: '第1章' }, { text: 'foo 内容' }]
    applyChapterReplacements(runs, [rule()], 'ch.xhtml')
    expect(runs).toEqual([{ text: '第1章' }, { text: 'bar 内容' }])
  })

  it('applies title scope independently from content scope', () => {
    const runs = [{ text: 'foo 标题' }, { text: 'foo 内容' }]
    applyChapterReplacements(runs, [rule({ applyTo: 'title' })], 'ch.xhtml')
    expect(runs).toEqual([{ text: 'bar 标题' }, { text: 'foo 内容' }])
  })

  it('skips disabled pattern rules', () => {
    const runs = [{ text: 'foo' }]
    applyChapterReplacements(runs, [rule({ effectiveEnabled: false })], 'ch.xhtml')
    expect(runs).toEqual([{ text: 'foo' }])
  })

  it('applies a point patch at the offset that includes the title prefix', () => {
    // rendered section text = "第1章" + "第一段" + "第二段" — offset 8 is 第二段's start
    const runs = [{ text: '第1章' }, { text: '第一段' }, { text: '第二段' }]
    applyChapterReplacements(runs, [
      rule({
        id: 'p1',
        matchType: 'point',
        pattern: null,
        replacement: '改',
        effectiveEnabled: true,
        spineHref: 'ch.xhtml',
        textOffset: 8,
        originalText: '第二段',
      }),
    ], 'ch.xhtml')
    expect(runs[2]).toEqual({ text: '改' })
  })

  it('applies a point patch across runs', () => {
    const runs = [{ text: '前错' }, { text: '误后' }]
    applyChapterReplacements(runs, [
      rule({
        id: 'p1',
        matchType: 'point',
        pattern: null,
        replacement: '修正',
        effectiveEnabled: true,
        spineHref: 'ch.xhtml',
        textOffset: 1,
        originalText: '错误',
      }),
    ], 'ch.xhtml')
    expect(runs).toEqual([{ text: '前修正' }, { text: '后' }])
  })

  it('only touches the section the patch anchors to', () => {
    const runs = [{ text: '第二段' }]
    applyChapterReplacements(runs, [
      rule({ id: 'p1', matchType: 'point', pattern: null, replacement: '改', effectiveEnabled: true, spineHref: 'other.xhtml', textOffset: 0, originalText: '第二段' }),
    ], 'ch.xhtml')
    expect(runs).toEqual([{ text: '第二段' }])
  })

  it('silently skips an invalid patch whose snapshot is gone', () => {
    const runs = [{ text: '正文内容' }]
    applyChapterReplacements(runs, [
      rule({ id: 'p1', matchType: 'point', pattern: null, replacement: '改', effectiveEnabled: true, spineHref: 'ch.xhtml', textOffset: 0, originalText: '不存在的文本' }),
    ], 'ch.xhtml')
    expect(runs).toEqual([{ text: '正文内容' }])
  })

  it('assembles chapters as title + blank line + one-line paragraphs, chapters separated by two blank lines', () => {
    expect(assembleTxt([
      { title: '第1章', paragraphs: ['甲', '乙'] },
      { title: '第2章', paragraphs: ['丙'] },
    ])).toBe('第1章\n\n甲\n乙\n\n\n第2章\n\n丙\n')
  })
})

describe('exportTxtBook', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let ownerId: string
  let bookId: string

  beforeAll(() => {
    registerParser(new TxtParser())
  })

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    ownerId = seedUser(db, 'owner')
    const file = new File(['第1章\n\n第一段文字内容\n\n第二段文字内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    bookId = book.id
  })

  it('returns the plain normalized text when there are no rules', async () => {
    const { text } = await exportTxtBook(ownerId, bookId)
    expect(text).toBe('第1章\n\n第一段文字内容\n第二段文字内容\n')
  })

  it('applies effective pattern rules and anchored point patches', async () => {
    await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    // section text = "第1章"(3) + "第一段文字内容"(7) + "第二段文字内容" — 第二段 starts at 14.
    // The spine href is the full zip path the reader records (foliate section id).
    await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'OEBPS/chapter-0001.xhtml', textOffset: 14,
      originalText: '第二段文字内容', replacement: '测试一处',
    })
    // invalid patch (snapshot gone) must be skipped silently
    await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'OEBPS/chapter-0001.xhtml', textOffset: 0,
      originalText: '不存在', replacement: 'x',
    })
    // a patch anchored with a bare href (not the reader's form) must not apply
    await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'chapter-0001.xhtml', textOffset: 0,
      originalText: '第一段文字内容', replacement: '不应生效',
    })

    const { text } = await exportTxtBook(ownerId, bookId)
    expect(text).toBe('第1章\n\n改后段文字内容\n测试一处\n')
  })

  it('honors per-book overrides in the export', async () => {
    const created = await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    const db = client.getDb()
    db.insert(schema.textReplacementOverrides).values({
      id: createId('tfo'),
      userId: ownerId,
      bookId,
      replacementId: created.id,
      enabled: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()

    const { text } = await exportTxtBook(ownerId, bookId)
    expect(text).toBe('第1章\n\n第一段文字内容\n第二段文字内容\n')
  })

  it('returns the unreplaced text for the plain (原文) variant even with rules', async () => {
    await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    const { text } = await exportTxtBook(ownerId, bookId, true)
    expect(text).toBe('第1章\n\n第一段文字内容\n第二段文字内容\n')
  })

  it('reports edited=false when no rule is effectively enabled', async () => {
    await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    const { edited } = await exportTxtBook(ownerId, bookId)
    expect(edited).toBe(true)
    const { edited: off } = await exportTxtBook(ownerId, bookId, true)
    expect(off).toBe(false)
  })

  it('reports edited=false when every rule is disabled or overridden off', async () => {
    await createReplacement(ownerId, { pattern: 'x', replacement: 'y', enabled: false })
    const overridden = await createReplacement(ownerId, { pattern: 'z', replacement: 'w' })
    const db = client.getDb()
    db.insert(schema.textReplacementOverrides).values({
      id: createId('tfo'),
      userId: ownerId,
      bookId,
      replacementId: overridden.id,
      enabled: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
    const { edited } = await exportTxtBook(ownerId, bookId)
    expect(edited).toBe(false)
  })

  it('rejects EPUB books with UNSUPPORTED_FORMAT', async () => {
    const epub = seedBook(db, ownerId, { format: 'epub' })
    mem.files.set(epub.filePath, Buffer.from('not a real epub'))
    await expect(exportTxtBook(ownerId, epub.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
  })

  it('rejects another user\'s book with BOOK_NOT_FOUND', async () => {
    const otherId = seedUser(db, 'other')
    await expect(exportTxtBook(otherId, bookId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })
})

describe('exportEpubBook', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let ownerId: string
  let bookId: string

  beforeAll(() => {
    registerParser(new TxtParser())
  })

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    ownerId = seedUser(db, 'owner')
    const file = new File(['第1章\n\n第一段文字内容\n\n第二段文字内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    bookId = book.id
  })

  it('regenerates an epub with the rules applied and the current metadata', async () => {
    await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    // New model: title/author live on the library work row, not books.
    const lbv = client.getDb().select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, bookId)).get()!
    client.getDb().update(schema.libraryBooks)
      .set({ title: '改名后的书', author: '某作者' })
      .where(eq(schema.libraryBooks.id, lbv.libraryBookId)).run()
    const { buffer, title } = await exportEpubBook(ownerId, bookId)
    expect(title).toBe('改名后的书')
    const zip = await JSZip.loadAsync(buffer)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>改名后的书</dc:title>')
    expect(opf).toContain('<dc:creator>某作者</dc:creator>')
    const chapter = await zip.file('OEBPS/chapter-0001.xhtml')!.async('string')
    expect(chapter).toContain('<p>改后段文字内容</p>')
    expect(chapter).not.toContain('<p>第一段文字内容</p>')
  })

  it('returns the unreplaced content for the plain variant even with rules', async () => {
    await createReplacement(ownerId, { pattern: '第一段', replacement: '改后段' })
    const { buffer } = await exportEpubBook(ownerId, bookId, true)
    const zip = await JSZip.loadAsync(buffer)
    const chapter = await zip.file('OEBPS/chapter-0001.xhtml')!.async('string')
    expect(chapter).toContain('<p>第一段文字内容</p>')
    expect(chapter).not.toContain('<p>改后段文字内容</p>')
  })

  it('embeds the cover into the package and manifest when the book has one', async () => {
    const coverKey = `blobs/co/${createId('hash')}.cover.png`
    const coverLbv = client.getDb().select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, bookId)).get()!
    client.getDb().update(schema.libraryBooks).set({ coverKey }).where(eq(schema.libraryBooks.id, coverLbv.libraryBookId)).run()
    mem.files.set(coverKey, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const { buffer } = await exportEpubBook(ownerId, bookId)
    const zip = await JSZip.loadAsync(buffer)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<meta name="cover" content="cover-image" />')
    expect(opf).toContain('<item id="cover-image" href="cover.png" media-type="image/png" />')
    const cover = await zip.file('OEBPS/cover.png')!.async('uint8array')
    expect([...cover]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('exports without a cover when the cover blob is missing (silent degradation)', async () => {
    const missingLbv = client.getDb().select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, bookId)).get()!
    client.getDb().update(schema.libraryBooks).set({ coverKey: `blobs/co/${createId('hash')}.cover.jpg` }).where(eq(schema.libraryBooks.id, missingLbv.libraryBookId)).run()
    const { buffer } = await exportEpubBook(ownerId, bookId)
    const zip = await JSZip.loadAsync(buffer)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).not.toContain('cover-image')
  })

  it('rejects EPUB books with UNSUPPORTED_FORMAT', async () => {
    const epub = seedBook(db, ownerId, { format: 'epub' })
    mem.files.set(epub.filePath, Buffer.from('not a real epub'))
    await expect(exportEpubBook(ownerId, epub.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
  })

  it('rejects another user\'s book with BOOK_NOT_FOUND', async () => {
    const otherId = seedUser(db, 'other')
    await expect(exportEpubBook(otherId, bookId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })
})

describe('GET /books/:id/export.txt', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let ownerId: string

  function createFileApp() {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/books/*', async (c, next) => {
      c.set('user', { id: ownerId, username: 'owner', role: 'owner', avatarKey: null })
      return next()
    })
    app.route('/api/v1/books', booksRoutes)
    return app
  }

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    ownerId = seedUser(db, 'owner')
    registerParser(new TxtParser())
  })

  it('returns the edited text as a download attachment', async () => {
    const file = new File(['第1章\n\n正文内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    await createReplacement(ownerId, { pattern: '正文', replacement: '改文' })

    const res = await createFileApp().request(`/api/v1/books/${book.id}/export.txt`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(res.headers.get('Content-Disposition')).toContain(encodeURIComponent('book.校订版.txt'))
    expect(await res.text()).toBe('第1章\n\n改文内容\n')
  })

  it('rejects EPUB books with 415 UNSUPPORTED_FORMAT', async () => {
    const epub = seedBook(db, ownerId, { format: 'epub', filePath: `blobs/te/${createId('hash')}.epub` })
    mem.files.set(epub.filePath, Buffer.from('x'))
    const res = await createFileApp().request(`/api/v1/books/${epub.id}/export.txt`)
    expect(res.status).toBe(415)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_FORMAT')
  })
})

describe('GET /books/:id/export.epub', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let ownerId: string

  function createFileApp() {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/books/*', async (c, next) => {
      c.set('user', { id: ownerId, username: 'owner', role: 'owner', avatarKey: null })
      return next()
    })
    app.route('/api/v1/books', booksRoutes)
    return app
  }

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    ownerId = seedUser(db, 'owner')
    registerParser(new TxtParser())
  })

  it('returns the edited epub as a download attachment', async () => {
    const file = new File(['第1章\n\n正文内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    await createReplacement(ownerId, { pattern: '正文', replacement: '改文' })

    const res = await createFileApp().request(`/api/v1/books/${book.id}/export.epub`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/epub+zip')
    expect(res.headers.get('Content-Disposition')).toContain(encodeURIComponent('book-校订版.epub'))
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const chapter = await zip.file('OEBPS/chapter-0001.xhtml')!.async('string')
    expect(chapter).toContain('<p>改文内容</p>')
  })

  it('supports the plain variant via ?plain=1', async () => {
    const file = new File(['第1章\n\n正文内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    await createReplacement(ownerId, { pattern: '正文', replacement: '改文' })

    const res = await createFileApp().request(`/api/v1/books/${book.id}/export.epub?plain=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain(encodeURIComponent('book.epub'))
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const chapter = await zip.file('OEBPS/chapter-0001.xhtml')!.async('string')
    expect(chapter).toContain('<p>正文内容</p>')
    expect(chapter).not.toContain('<p>改文内容</p>')
  })

  it('names the default export 原文 when no rule is effectively enabled', async () => {
    const file = new File(['第1章\n\n正文内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    await createReplacement(ownerId, { pattern: '正文', replacement: '改文', enabled: false })

    const res = await createFileApp().request(`/api/v1/books/${book.id}/export.epub`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain(encodeURIComponent('book.epub'))
    expect(res.headers.get('Content-Disposition')).not.toContain('校订版')
  })

  it('applies the point patch anchored to the reader-style full zip path', async () => {
    const file = new File(['第1章\n\n第一段文字内容\n\n第二段文字内容'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    await createReplacement(ownerId, {
      matchType: 'point', bookId: book.id, spineHref: 'OEBPS/chapter-0001.xhtml', textOffset: 12,
      originalText: '第二段文字内容', replacement: '定点生效',
    })

    const res = await createFileApp().request(`/api/v1/books/${book.id}/export.epub`)
    const zip = await JSZip.loadAsync(await res.arrayBuffer())
    const chapter = await zip.file('OEBPS/chapter-0001.xhtml')!.async('string')
    expect(chapter).toContain('<p>定点生效</p>')
  })

  it('rejects EPUB books with 415 UNSUPPORTED_FORMAT', async () => {
    const epub = seedBook(db, ownerId, { format: 'epub', filePath: `blobs/te/${createId('hash')}.epub` })
    mem.files.set(epub.filePath, Buffer.from('x'))
    const res = await createFileApp().request(`/api/v1/books/${epub.id}/export.epub`)
    expect(res.status).toBe(415)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_FORMAT')
  })
})
