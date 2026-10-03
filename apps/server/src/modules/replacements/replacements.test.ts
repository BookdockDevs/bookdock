import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyRuleToText, replacementCreateSchema, replacementOverrideSchema, replacementUpdateSchema } from '@bookdock/shared'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import { loadEffectiveBookReplacementRules } from '../books/replacement-rules'
import replacementRoutes from './replacements.routes'
import {
  listReplacements,
  createReplacement,
  updateReplacement,
  deleteReplacement,
  deleteGlobalReplacements,
  setReplacementOverride,
  importReplacements,
} from './replacements.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function mirrorPrivateBook(db: ReturnType<typeof createTestDb>, userId: string, bookIds: string[]) {
  const now = Date.now()
  const libraryId = `private-${userId}`
  db.insert(schema.libraries).values({ id: libraryId, userId, type: 'private', name: 'Private', description: '', visibility: null, createdAt: now, updatedAt: now }).run()
  for (const bookId of bookIds) {
    db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: now, updatedAt: now }).run()
    db.insert(schema.contentRevisions).values({ id: `revision-${bookId}`, bookVersionId: bookId, revisionNo: 1, blobKey: `books/test/${bookId}.txt`, size: 100, chapterCount: 0, meta: {}, createdAt: now }).run()
    const libraryBookId = `library-book-${bookId}`
    db.insert(schema.libraryBooks).values({ id: libraryBookId, libraryId, userId, title: 'Test Book', author: 'Author', description: '', coverKey: null, createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryBookVersions).values({ id: `link-${bookId}`, libraryId, libraryBookId, bookVersionId: bookId, kind: 'personal', status: 'published', createdAt: now, updatedAt: now }).run()
  }
}

describe('replacements service', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let bookId: string
  let otherBookId: string

  function insertBook(id: string, userId: string, title: string) {
    db.insert(schema.books).values({
      id,
      userId,
      title,
      author: 'Author',
      format: 'txt',
      filePath: `books/test/${id}.txt`,
      coverKey: null,
      size: 100,
      meta: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
    otherId = createId('user')
    db.insert(schema.users).values({
      id: otherId,
      username: 'other',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    insertBook(bookId, ownerId, 'Test Book')
    otherBookId = createId('book')
    insertBook(otherBookId, ownerId, 'Other Book')
    mirrorPrivateBook(db, ownerId, [bookId, otherBookId])
  })

  it('deletes selected global rules and their overrides without affecting other rules', async () => {
    const a = await createReplacement(ownerId, { pattern: 'a' })
    const b = await createReplacement(ownerId, { pattern: 'b' })
    const keep = await createReplacement(ownerId, { bookId, pattern: 'keep' })
    await setReplacementOverride(ownerId, a.id, { bookId, enabled: false })
    deleteGlobalReplacements(ownerId, [a.id, b.id])
    expect((await listReplacements(ownerId)).map((rule) => rule.id)).toEqual([keep.id])
    expect(db.select().from(schema.textReplacementOverrides).all()).toHaveLength(0)
  })

  it('rejects mixed foreign, missing, book-scoped, and point targets without deleting a valid global rule', async () => {
    const global = await createReplacement(ownerId, { pattern: 'global' })
    const foreign = await createReplacement(otherId, { pattern: 'foreign' })
    const scoped = await createReplacement(ownerId, { bookId, pattern: 'book' })
    const point = await createReplacement(ownerId, { bookId, matchType: 'point', spineHref: 'chapter.xhtml', textOffset: 0, originalText: 'old', replacement: 'new' })
    for (const invalid of [foreign.id, scoped.id, point.id, 'missing']) {
      expect(() => deleteGlobalReplacements(ownerId, [global.id, invalid])).toThrow('REPLACEMENT_NOT_FOUND')
      expect((await listReplacements(ownerId)).some((rule) => rule.id === global.id)).toBe(true)
    }
  })

  it('rolls back all rows when database deletion fails', async () => {
    const a = await createReplacement(ownerId, { pattern: 'a', name: 'first' })
    const b = await createReplacement(ownerId, { pattern: 'b', name: 'blocked' })
    db.run(sql`CREATE TRIGGER reject_batch_delete BEFORE DELETE ON text_replacements
      WHEN OLD.name = 'blocked' BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END`)
    expect(() => deleteGlobalReplacements(ownerId, [a.id, b.id])).toThrow('test deletion failure')
    expect((await listReplacements(ownerId)).map((rule) => rule.id)).toEqual([a.id, b.id])
  })

  it('creates a pattern replacement as user-global and lists it with effective fields for a book', async () => {
    const created = await createReplacement(ownerId, {
      pattern: '广告',
      replacement: null,
      isRegex: false,
      enabled: true,
    })
    expect(created.bookId).toBeNull()
    expect(created.scope).toBe('global')
    expect(created.enabled).toBe(true)

    const items = await listReplacements(ownerId, bookId)
    expect(items).toHaveLength(1)
    expect(items[0].pattern).toBe('广告')
    expect(items[0].effectiveEnabled).toBe(true)
    expect(items[0].hasOverride).toBe(false)
  })

  it('creates a book-scoped pattern rule when a bookId is passed', async () => {
    const created = await createReplacement(ownerId, { bookId, pattern: 'book rule' })
    expect(created.bookId).toBe(bookId)
    expect(created.scope).toBe('book')

    const forBook = await listReplacements(ownerId, bookId)
    expect(forBook).toHaveLength(1)
    expect(forBook[0].matchType).toBe('pattern')
    expect(forBook[0].effectiveEnabled).toBe(true)
    expect(forBook[0].hasOverride).toBe(false)
  })

  it('binds the version for scoped rules once the book migrated', async () => {
    const before = await createReplacement(ownerId, { bookId, pattern: 'before' })
    expect(db.select({ bookVersionId: schema.textReplacements.bookVersionId }).from(schema.textReplacements).where(eq(schema.textReplacements.id, before.id)).get())
      .toEqual({ bookVersionId: bookId })

    const after = await createReplacement(ownerId, { bookId, pattern: 'after' })
    expect(db.select({ bookVersionId: schema.textReplacements.bookVersionId }).from(schema.textReplacements).where(eq(schema.textReplacements.id, after.id)).get())
      .toEqual({ bookVersionId: bookId })
  })

  it('rejects book-scoped patterns on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(createReplacement(otherId, { bookId, pattern: 'x' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('requires bookId for point replacements', async () => {
    await expect(createReplacement(ownerId, {
      matchType: 'point',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('returns global rules plus only this book\'s scoped rows when filtering by bookId', async () => {
    await createReplacement(ownerId, { pattern: 'global rule' })
    await createReplacement(ownerId, { bookId, pattern: 'book rule' })
    await createReplacement(ownerId, { bookId: otherBookId, pattern: 'other book rule' })
    await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'a',
    })
    await createReplacement(ownerId, {
      matchType: 'point', bookId: otherBookId, spineHref: 'c1', textOffset: 1, originalText: 'b',
    })

    const forBook = await listReplacements(ownerId, bookId)
    expect(forBook).toHaveLength(3)
    expect(forBook.filter((t) => t.bookId === null)).toHaveLength(1)
    expect(forBook.filter((t) => t.matchType === 'pattern' && t.bookId === bookId)).toHaveLength(1)
    expect(forBook.filter((t) => t.matchType === 'point')).toHaveLength(1)

    // another book's scoped pattern rule must not leak into this book's view
    expect(forBook.some((t) => t.pattern === 'other book rule')).toBe(false)

    const all = await listReplacements(ownerId)
    expect(all).toHaveLength(5)
    expect(all[0].effectiveEnabled).toBeUndefined()
    expect(all[0].hasOverride).toBeUndefined()
  })

  it('does not leak other users\' replacements into list results', async () => {
    await createReplacement(otherId, { pattern: 'other user rule' })
    expect(await listReplacements(ownerId)).toHaveLength(0)
    expect(await listReplacements(ownerId, bookId)).toHaveLength(0)
  })

  it('rejects point creation on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(createReplacement(otherId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'x',
    })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('updates fields and toggles enabled', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo', replacement: 'bar' })
    const updated = await updateReplacement(ownerId, created.id, {
      replacement: 'baz',
      enabled: false,
      name: 'rule 1',
      group: 'cleanup',
    })
    expect(updated.replacement).toBe('baz')
    expect(updated.enabled).toBe(false)
    expect(updated.name).toBe('rule 1')
    expect(updated.group).toBe('cleanup')
    expect(updated.pattern).toBe('foo')
  })

  it('rejects update and delete from another user with REPLACEMENT_NOT_FOUND', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo' })
    await expect(updateReplacement(otherId, created.id, { enabled: false }))
      .rejects.toMatchObject({ code: 'REPLACEMENT_NOT_FOUND' })
    await expect(deleteReplacement(otherId, created.id))
      .rejects.toMatchObject({ code: 'REPLACEMENT_NOT_FOUND' })
    expect(await listReplacements(ownerId)).toHaveLength(1)
  })

  it('deletes the replacement for the owner', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo' })
    await deleteReplacement(ownerId, created.id)
    expect(await listReplacements(ownerId)).toHaveLength(0)
  })

  it('rejects an update that turns pattern into an invalid regex', async () => {
    const created = await createReplacement(ownerId, { pattern: '([', isRegex: false })
    await expect(updateReplacement(ownerId, created.id, { isRegex: true }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('edits a point patch snapshot via originalText', async () => {
    const created = await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '旧文',
    })
    const updated = await updateReplacement(ownerId, created.id, { originalText: '新文' })
    expect(updated.originalText).toBe('新文')
    expect(updated.matchType).toBe('point')
  })

  it('converts a point patch into a book-scoped pattern (snapshot becomes pattern, anchors cleared)', async () => {
    const created = await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '错字',
    })
    const updated = await updateReplacement(ownerId, created.id, {
      matchType: 'pattern', pattern: '错字', isRegex: false,
    })
    expect(updated.matchType).toBe('pattern')
    expect(updated.pattern).toBe('错字')
    expect(updated.bookId).toBe(bookId)
    expect(updated.spineHref).toBeNull()
    expect(updated.textOffset).toBeNull()
    expect(updated.originalText).toBeNull()
  })

  it('promotes a point patch to a global rule via bookId: null', async () => {
    const created = await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '错字',
    })
    const updated = await updateReplacement(ownerId, created.id, {
      matchType: 'pattern', pattern: '错字', bookId: null,
    })
    expect(updated.bookId).toBeNull()
    expect(updated.scope).toBe('global')
  })

  it('rebinds a global pattern rule to a book and back', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo' })
    const scoped = await updateReplacement(ownerId, created.id, { bookId })
    expect(scoped.bookId).toBe(bookId)
    expect(scoped.scope).toBe('book')

    const global = await updateReplacement(ownerId, created.id, { bookId: null })
    expect(global.bookId).toBeNull()
    expect(global.scope).toBe('global')
  })

  it('rejects binding a rule to a book the user does not own', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo' })
    await expect(updateReplacement(ownerId, created.id, { bookId: 'missing-book' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('rejects conversion to a point patch (needs a selection anchor)', async () => {
    const created = await createReplacement(ownerId, { pattern: 'foo' })
    await expect(updateReplacement(ownerId, created.id, { matchType: 'point' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('replacement overrides', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
    otherId = createId('user')
    db.insert(schema.users).values({
      id: otherId,
      username: 'other',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId,
      userId: ownerId,
      title: 'Test Book',
      author: 'Author',
      format: 'txt',
      filePath: 'books/test/test.txt',
      coverKey: null,
      size: 100,
      meta: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
    mirrorPrivateBook(db, ownerId, [bookId])
  })

  it('upserts an override and repeated puts with the same value are idempotent', async () => {
    const rule = await createReplacement(ownerId, { pattern: 'foo', enabled: true })
    const first = await setReplacementOverride(ownerId, rule.id, { bookId, enabled: false })
    expect(first.effectiveEnabled).toBe(false)
    expect(first.hasOverride).toBe(true)
    expect(first.enabled).toBe(true)

    const second = await setReplacementOverride(ownerId, rule.id, { bookId, enabled: false })
    expect(second.effectiveEnabled).toBe(false)
    expect(second.hasOverride).toBe(true)

    const rows = db.select().from(schema.textReplacementOverrides).all()
    expect(rows).toHaveLength(1)
  })

  it('updates an existing override when the value changes', async () => {
    const rule = await createReplacement(ownerId, { pattern: 'foo', enabled: false })
    await setReplacementOverride(ownerId, rule.id, { bookId, enabled: false })
    const flipped = await setReplacementOverride(ownerId, rule.id, { bookId, enabled: true })
    expect(flipped.effectiveEnabled).toBe(true)
    expect(db.select().from(schema.textReplacementOverrides).all()).toHaveLength(1)
  })

  it('enabled=null deletes the override and restores inheritance', async () => {
    const rule = await createReplacement(ownerId, { pattern: 'foo', enabled: true })
    await setReplacementOverride(ownerId, rule.id, { bookId, enabled: false })
    const restored = await setReplacementOverride(ownerId, rule.id, { bookId, enabled: null })
    expect(restored.effectiveEnabled).toBe(true)
    expect(restored.hasOverride).toBe(false)
    expect(db.select().from(schema.textReplacementOverrides).all()).toHaveLength(0)
  })

  it('computes effectiveEnabled/hasOverride in the book-filtered list', async () => {
    const globalOn = await createReplacement(ownerId, { pattern: 'on', enabled: true })
    const globalOff = await createReplacement(ownerId, { pattern: 'off', enabled: false })
    const inherited = await createReplacement(ownerId, { pattern: 'inherit', enabled: false })
    await setReplacementOverride(ownerId, globalOn.id, { bookId, enabled: false })
    await setReplacementOverride(ownerId, globalOff.id, { bookId, enabled: true })

    const items = await listReplacements(ownerId, bookId)
    const byId = new Map(items.map((t) => [t.id, t]))
    expect(byId.get(globalOn.id)).toMatchObject({ enabled: true, effectiveEnabled: false, hasOverride: true })
    expect(byId.get(globalOff.id)).toMatchObject({ enabled: false, effectiveEnabled: true, hasOverride: true })
    expect(byId.get(inherited.id)).toMatchObject({ enabled: false, effectiveEnabled: false, hasOverride: false })
  })

  it('rejects overrides on point replacements with VALIDATION_ERROR', async () => {
    const point = await createReplacement(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'x',
    })
    await expect(setReplacementOverride(ownerId, point.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects overrides on book-scoped pattern rules (already book-bound)', async () => {
    const scoped = await createReplacement(ownerId, { bookId, pattern: 'book rule' })
    await expect(setReplacementOverride(ownerId, scoped.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects overrides for another user\'s transform or book', async () => {
    const rule = await createReplacement(ownerId, { pattern: 'foo' })
    await expect(setReplacementOverride(otherId, rule.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'REPLACEMENT_NOT_FOUND' })
    await expect(setReplacementOverride(ownerId, rule.id, { bookId: 'missing-book', enabled: false }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })
})

describe('replacement ordering and import', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId,
      userId: ownerId,
      title: 'Test Book',
      author: 'Author',
      format: 'txt',
      filePath: 'books/test/test.txt',
      coverKey: null,
      size: 100,
      meta: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
    mirrorPrivateBook(db, ownerId, [bookId])
  })

  function transferFile(names: Array<string | null>) {
    return {
      kind: 'bookdock.text-replacements' as const,
      formatVersion: 1 as const,
      rules: names.map((name, index) => ({
        name,
        group: index === 0 ? 'g' : null,
        pattern: `p${index}`,
        replacement: index === 0 ? null : `r${index}`,
        isRegex: false,
        applyTo: 'content' as const,
        enabled: true,
      })),
    }
  }

  it('lists creations oldest-first and appends new rules at the end', async () => {
    const a = await createReplacement(ownerId, { pattern: 'a', name: 'a' })
    const b = await createReplacement(ownerId, { pattern: 'b', name: 'b' })
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1])
    const items = await listReplacements(ownerId)
    expect(items.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('loads effective book rules in list order so chained replacements compose', async () => {
    await createReplacement(ownerId, { pattern: 'x', replacement: 'y', name: 'first' })
    await createReplacement(ownerId, { pattern: 'y', replacement: 'z', name: 'second' })
    const rules = await loadEffectiveBookReplacementRules(ownerId, bookId)
    expect(rules.map((r) => r.pattern)).toEqual(['x', 'y'])
    let text = 'x'
    for (const rule of rules) {
      if (rule.matchType !== 'pattern' || !rule.pattern || !rule.effectiveEnabled) continue
      text = applyRuleToText(text, { id: rule.id, pattern: rule.pattern, replacement: rule.replacement, isRegex: rule.isRegex })
    }
    expect(text).toBe('z')
  })

  it('imports global patterns disabled at the end, keeping group and delete semantics', async () => {
    await createReplacement(ownerId, { pattern: 'existing', name: 'existing' })
    const imported = await importReplacements(ownerId, transferFile(['n1', null]))
    expect(imported.map((r) => r.name)).toEqual(['n1', null])
    expect(imported.every((r) => r.enabled === false)).toBe(true)
    expect(imported.every((r) => r.scope === 'global')).toBe(true)
    expect(imported[0]).toMatchObject({ group: 'g', replacement: null, sortOrder: 1 })
    const items = await listReplacements(ownerId)
    expect(items.map((r) => r.pattern)).toEqual(['existing', 'p0', 'p1'])
  })

  it('rejects existing and file-internal name conflicts but allows repeated empty names', async () => {
    await createReplacement(ownerId, { pattern: 'x', name: 'taken' })
    const before = (await listReplacements(ownerId)).length
    await expect(importReplacements(ownerId, transferFile([' fresh ', 'fresh'])))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(importReplacements(ownerId, transferFile(['taken'])))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(importReplacements(ownerId, transferFile([' taken '])))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const unnamed = await importReplacements(ownerId, transferFile([null, null]))
    expect(unnamed).toHaveLength(2)
    expect((await listReplacements(ownerId)).length).toBe(before + 2)
  })

  it('rejects smuggled book scope, invalid regex, and empty files without saving', async () => {
    const before = (await listReplacements(ownerId)).length
    const badFiles = [
      { kind: 'bookdock.text-replacements', formatVersion: 1, rules: [{ pattern: 'x', bookId, isRegex: false }] },
      { kind: 'bookdock.text-replacements', formatVersion: 1, rules: [{ pattern: '([', isRegex: true }] },
      { kind: 'bookdock.toc-rules', formatVersion: 1, rules: [] },
      { kind: 'bookdock.text-replacements', formatVersion: 1, rules: [] },
    ]
    for (const file of badFiles) {
      await expect(importReplacements(ownerId, file)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    expect(await listReplacements(ownerId)).toHaveLength(before)
  })

  it('backfills legacy rows per user in createdAt order (0038)', async () => {
    const otherId = createId('user')
    db.insert(schema.users).values({ id: otherId, username: 'other', passwordHash: null, role: 'owner', createdAt: Date.now() }).run()
    const base = Date.now()
    // Physical insertion order is newest-first so only createdAt may decide.
    const seedRows = [
      { id: createId('replacement'), createdAt: base + 30 },
      { id: createId('replacement'), createdAt: base + 20 },
      { id: createId('replacement'), createdAt: base + 10 },
    ]
    for (const [index, seed] of seedRows.entries()) {
      db.insert(schema.textReplacements).values({
        id: seed.id,
        userId: ownerId,
        pattern: `legacy-${index}`,
        sortOrder: 0,
        createdAt: seed.createdAt,
        updatedAt: seed.createdAt,
      }).run()
    }
    db.insert(schema.textReplacements).values({
      id: createId('replacement'),
      userId: otherId,
      pattern: 'other',
      sortOrder: 0,
      createdAt: base + 99,
      updatedAt: base + 99,
    }).run()

    const migrationSql = readFileSync(
      path.join(__dirname, '..', '..', 'db', 'migrations', '0038_replacement_sort_order.sql'),
      'utf8',
    )
    db.run(sql.raw(migrationSql.split('statement-breakpoint')[1]!))

    const mine = db.select().from(schema.textReplacements).where(eq(schema.textReplacements.userId, ownerId)).all()
      .sort((a, b) => a.createdAt - b.createdAt)
    expect(mine.map((r) => r.sortOrder)).toEqual([0, 1, 2])
    expect(mine.map((r) => r.pattern)).toEqual(['legacy-2', 'legacy-1', 'legacy-0'])
    const theirs = db.select().from(schema.textReplacements).where(eq(schema.textReplacements.userId, otherId)).all()
    expect(theirs.map((r) => r.sortOrder)).toEqual([0])
  })
})

describe('replacement routes', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  function createApp(guest = false) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/replacements/*', async (c, next) => {
      c.set('user', { id: ownerId, username: 'owner', role: guest ? 'guest' : 'owner', avatarKey: null })
      return next()
    })
    app.route('/api/v1/replacements', replacementRoutes)
    return app
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
  })

  it('batch-deletes selected global rules through the route', async () => {
    const a = await createReplacement(ownerId, { pattern: 'a' })
    const b = await createReplacement(ownerId, { pattern: 'b' })
    const response = await createApp().request('http://test/api/v1/replacements/batch-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruleIds: [a.id] }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: null })
    expect((await listReplacements(ownerId)).map((rule) => rule.id)).toEqual([b.id])
  })

  it('rejects guest batch deletion', async () => {
    const a = await createReplacement(ownerId, { pattern: 'a' })
    const response = await createApp(true).request('http://test/api/v1/replacements/batch-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruleIds: [a.id] }),
    })
    expect(response.status).toBe(403)
    expect(await listReplacements(ownerId)).toHaveLength(1)
  })

  it.each(['{"ruleIds":[]}', '{"ruleIds":["same","same"]}', '{'])('rejects invalid batch payload %s', async (body) => {
    const a = await createReplacement(ownerId, { pattern: 'a' })
    const response = await createApp().request('http://test/api/v1/replacements/batch-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    expect(response.status).toBe(400)
    expect((await listReplacements(ownerId)).map((rule) => rule.id)).toEqual([a.id])
  })

  it('POST /import batch-creates disabled global rules', async () => {
    const app = createApp()
    const res = await app.request('http://test/api/v1/replacements/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'bookdock.text-replacements',
        formatVersion: 1,
        rules: [{ name: 'r1', pattern: 'a', replacement: 'b', isRegex: false, applyTo: 'both', enabled: true }],
      }),
    })
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: { name: string; enabled: boolean; applyTo: string }[] }
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ name: 'r1', enabled: false, applyTo: 'both' })
  })

  it('POST /import rejects conflicts without saving the valid subset', async () => {
    const app = createApp()
    await createReplacement(ownerId, { pattern: 'x', name: 'taken' })
    const res = await app.request('http://test/api/v1/replacements/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'bookdock.text-replacements',
        formatVersion: 1,
        rules: [
          { name: 'fresh', pattern: 'fresh', enabled: true },
          { name: 'taken', pattern: 'taken2', enabled: true },
        ],
      }),
    })
    expect(res.status).toBe(400)
    expect((await listReplacements(ownerId)).some((r) => r.pattern === 'fresh')).toBe(false)
  })
})

describe('replacement schemas', () => {
  it('requires a non-empty pattern for pattern replacements', () => {
    expect(replacementCreateSchema.safeParse({ matchType: 'pattern' }).success).toBe(false)
    expect(replacementCreateSchema.safeParse({ matchType: 'pattern', pattern: '' }).success).toBe(false)
    expect(replacementCreateSchema.safeParse({ matchType: 'pattern', pattern: 'x' }).success).toBe(true)
  })

  it('allows bookId on pattern replacements (book-scoped)', () => {
    expect(replacementCreateSchema.safeParse({ matchType: 'pattern', pattern: 'x', bookId: 'b1' }).success).toBe(true)
  })

  it('rejects invalid regex when isRegex is true', () => {
    expect(replacementCreateSchema.safeParse({ pattern: '([', isRegex: true }).success).toBe(false)
    expect(replacementCreateSchema.safeParse({ pattern: '([', isRegex: false }).success).toBe(true)
    expect(replacementCreateSchema.safeParse({ pattern: '\\d+', isRegex: true }).success).toBe(true)
    expect(replacementCreateSchema.safeParse({ pattern: '(?i)广告', isRegex: true }).success).toBe(true)
  })

  it('requires anchors and bookId for point replacements', () => {
    expect(replacementCreateSchema.safeParse({ matchType: 'point' }).success).toBe(false)
    expect(replacementCreateSchema.safeParse({
      matchType: 'point',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
    }).success).toBe(false)
    const ok = replacementCreateSchema.safeParse({
      matchType: 'point',
      bookId: 'b1',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
      replacement: 'fixed',
    })
    expect(ok.success).toBe(true)
    expect(replacementCreateSchema.safeParse({
      matchType: 'point',
      bookId: 'b1',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
      applyTo: 'title',
    }).success).toBe(false)
  })

  it('accepts a partial update and the enabled toggle', () => {
    expect(replacementUpdateSchema.safeParse({ enabled: false }).success).toBe(true)
    expect(replacementUpdateSchema.safeParse({}).success).toBe(true)
  })

  it('validates the override request shape', () => {
    expect(replacementOverrideSchema.safeParse({ bookId: 'b1', enabled: true }).success).toBe(true)
    expect(replacementOverrideSchema.safeParse({ bookId: 'b1', enabled: null }).success).toBe(true)
    expect(replacementOverrideSchema.safeParse({ bookId: 'b1' }).success).toBe(false)
    expect(replacementOverrideSchema.safeParse({ enabled: true }).success).toBe(false)
  })
})
