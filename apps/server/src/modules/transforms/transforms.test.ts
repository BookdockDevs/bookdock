import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { transformCreateSchema, transformOverrideSchema, transformUpdateSchema } from '@bookdock/shared'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import {
  listTransforms,
  createTransform,
  updateTransform,
  deleteTransform,
  setTransformOverride,
} from './transforms.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('transforms service', () => {
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
  })

  it('creates a pattern transform as user-global and lists it with effective fields for a book', async () => {
    const created = await createTransform(ownerId, {
      pattern: '广告',
      replacement: null,
      isRegex: false,
      enabled: true,
    })
    expect(created.bookId).toBeNull()
    expect(created.scope).toBe('global')
    expect(created.enabled).toBe(true)

    const items = await listTransforms(ownerId, bookId)
    expect(items).toHaveLength(1)
    expect(items[0].pattern).toBe('广告')
    expect(items[0].effectiveEnabled).toBe(true)
    expect(items[0].hasOverride).toBe(false)
  })

  it('creates a book-scoped pattern rule when a bookId is passed', async () => {
    const created = await createTransform(ownerId, { bookId, pattern: 'book rule' })
    expect(created.bookId).toBe(bookId)
    expect(created.scope).toBe('book')

    const forBook = await listTransforms(ownerId, bookId)
    expect(forBook).toHaveLength(1)
    expect(forBook[0].matchType).toBe('pattern')
    expect(forBook[0].effectiveEnabled).toBe(true)
    expect(forBook[0].hasOverride).toBe(false)
  })

  it('rejects book-scoped patterns on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(createTransform(otherId, { bookId, pattern: 'x' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('requires bookId for point transforms', async () => {
    await expect(createTransform(ownerId, {
      matchType: 'point',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('returns global rules plus only this book\'s scoped rows when filtering by bookId', async () => {
    await createTransform(ownerId, { pattern: 'global rule' })
    await createTransform(ownerId, { bookId, pattern: 'book rule' })
    await createTransform(ownerId, { bookId: otherBookId, pattern: 'other book rule' })
    await createTransform(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'a',
    })
    await createTransform(ownerId, {
      matchType: 'point', bookId: otherBookId, spineHref: 'c1', textOffset: 1, originalText: 'b',
    })

    const forBook = await listTransforms(ownerId, bookId)
    expect(forBook).toHaveLength(3)
    expect(forBook.filter((t) => t.bookId === null)).toHaveLength(1)
    expect(forBook.filter((t) => t.matchType === 'pattern' && t.bookId === bookId)).toHaveLength(1)
    expect(forBook.filter((t) => t.matchType === 'point')).toHaveLength(1)

    // another book's scoped pattern rule must not leak into this book's view
    expect(forBook.some((t) => t.pattern === 'other book rule')).toBe(false)

    const all = await listTransforms(ownerId)
    expect(all).toHaveLength(5)
    expect(all[0].effectiveEnabled).toBeUndefined()
    expect(all[0].hasOverride).toBeUndefined()
  })

  it('does not leak other users\' transforms into list results', async () => {
    await createTransform(otherId, { pattern: 'other user rule' })
    expect(await listTransforms(ownerId)).toHaveLength(0)
    expect(await listTransforms(ownerId, bookId)).toHaveLength(0)
  })

  it('rejects point creation on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(createTransform(otherId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'x',
    })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('updates fields and toggles enabled', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo', replacement: 'bar' })
    const updated = await updateTransform(ownerId, created.id, {
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

  it('rejects update and delete from another user with TRANSFORM_NOT_FOUND', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo' })
    await expect(updateTransform(otherId, created.id, { enabled: false }))
      .rejects.toMatchObject({ code: 'TRANSFORM_NOT_FOUND' })
    await expect(deleteTransform(otherId, created.id))
      .rejects.toMatchObject({ code: 'TRANSFORM_NOT_FOUND' })
    expect(await listTransforms(ownerId)).toHaveLength(1)
  })

  it('deletes the transform for the owner', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo' })
    await deleteTransform(ownerId, created.id)
    expect(await listTransforms(ownerId)).toHaveLength(0)
  })

  it('rejects an update that turns pattern into an invalid regex', async () => {
    const created = await createTransform(ownerId, { pattern: '([', isRegex: false })
    await expect(updateTransform(ownerId, created.id, { isRegex: true }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('edits a point patch snapshot via originalText', async () => {
    const created = await createTransform(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '旧文',
    })
    const updated = await updateTransform(ownerId, created.id, { originalText: '新文' })
    expect(updated.originalText).toBe('新文')
    expect(updated.matchType).toBe('point')
  })

  it('converts a point patch into a book-scoped pattern (snapshot becomes pattern, anchors cleared)', async () => {
    const created = await createTransform(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '错字',
    })
    const updated = await updateTransform(ownerId, created.id, {
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
    const created = await createTransform(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: '错字',
    })
    const updated = await updateTransform(ownerId, created.id, {
      matchType: 'pattern', pattern: '错字', bookId: null,
    })
    expect(updated.bookId).toBeNull()
    expect(updated.scope).toBe('global')
  })

  it('rebinds a global pattern rule to a book and back', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo' })
    const scoped = await updateTransform(ownerId, created.id, { bookId })
    expect(scoped.bookId).toBe(bookId)
    expect(scoped.scope).toBe('book')

    const global = await updateTransform(ownerId, created.id, { bookId: null })
    expect(global.bookId).toBeNull()
    expect(global.scope).toBe('global')
  })

  it('rejects binding a rule to a book the user does not own', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo' })
    await expect(updateTransform(ownerId, created.id, { bookId: 'missing-book' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('rejects conversion to a point patch (needs a selection anchor)', async () => {
    const created = await createTransform(ownerId, { pattern: 'foo' })
    await expect(updateTransform(ownerId, created.id, { matchType: 'point' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('transform overrides', () => {
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
  })

  it('upserts an override and repeated puts with the same value are idempotent', async () => {
    const rule = await createTransform(ownerId, { pattern: 'foo', enabled: true })
    const first = await setTransformOverride(ownerId, rule.id, { bookId, enabled: false })
    expect(first.effectiveEnabled).toBe(false)
    expect(first.hasOverride).toBe(true)
    expect(first.enabled).toBe(true)

    const second = await setTransformOverride(ownerId, rule.id, { bookId, enabled: false })
    expect(second.effectiveEnabled).toBe(false)
    expect(second.hasOverride).toBe(true)

    const rows = db.select().from(schema.textTransformOverrides).all()
    expect(rows).toHaveLength(1)
  })

  it('updates an existing override when the value changes', async () => {
    const rule = await createTransform(ownerId, { pattern: 'foo', enabled: false })
    await setTransformOverride(ownerId, rule.id, { bookId, enabled: false })
    const flipped = await setTransformOverride(ownerId, rule.id, { bookId, enabled: true })
    expect(flipped.effectiveEnabled).toBe(true)
    expect(db.select().from(schema.textTransformOverrides).all()).toHaveLength(1)
  })

  it('enabled=null deletes the override and restores inheritance', async () => {
    const rule = await createTransform(ownerId, { pattern: 'foo', enabled: true })
    await setTransformOverride(ownerId, rule.id, { bookId, enabled: false })
    const restored = await setTransformOverride(ownerId, rule.id, { bookId, enabled: null })
    expect(restored.effectiveEnabled).toBe(true)
    expect(restored.hasOverride).toBe(false)
    expect(db.select().from(schema.textTransformOverrides).all()).toHaveLength(0)
  })

  it('computes effectiveEnabled/hasOverride in the book-filtered list', async () => {
    const globalOn = await createTransform(ownerId, { pattern: 'on', enabled: true })
    const globalOff = await createTransform(ownerId, { pattern: 'off', enabled: false })
    const inherited = await createTransform(ownerId, { pattern: 'inherit', enabled: false })
    await setTransformOverride(ownerId, globalOn.id, { bookId, enabled: false })
    await setTransformOverride(ownerId, globalOff.id, { bookId, enabled: true })

    const items = await listTransforms(ownerId, bookId)
    const byId = new Map(items.map((t) => [t.id, t]))
    expect(byId.get(globalOn.id)).toMatchObject({ enabled: true, effectiveEnabled: false, hasOverride: true })
    expect(byId.get(globalOff.id)).toMatchObject({ enabled: false, effectiveEnabled: true, hasOverride: true })
    expect(byId.get(inherited.id)).toMatchObject({ enabled: false, effectiveEnabled: false, hasOverride: false })
  })

  it('rejects overrides on point transforms with VALIDATION_ERROR', async () => {
    const point = await createTransform(ownerId, {
      matchType: 'point', bookId, spineHref: 'c1', textOffset: 1, originalText: 'x',
    })
    await expect(setTransformOverride(ownerId, point.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects overrides on book-scoped pattern rules (already book-bound)', async () => {
    const scoped = await createTransform(ownerId, { bookId, pattern: 'book rule' })
    await expect(setTransformOverride(ownerId, scoped.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects overrides for another user\'s transform or book', async () => {
    const rule = await createTransform(ownerId, { pattern: 'foo' })
    await expect(setTransformOverride(otherId, rule.id, { bookId, enabled: false }))
      .rejects.toMatchObject({ code: 'TRANSFORM_NOT_FOUND' })
    await expect(setTransformOverride(ownerId, rule.id, { bookId: 'missing-book', enabled: false }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })
})

describe('transform schemas', () => {
  it('requires a non-empty pattern for pattern transforms', () => {
    expect(transformCreateSchema.safeParse({ matchType: 'pattern' }).success).toBe(false)
    expect(transformCreateSchema.safeParse({ matchType: 'pattern', pattern: '' }).success).toBe(false)
    expect(transformCreateSchema.safeParse({ matchType: 'pattern', pattern: 'x' }).success).toBe(true)
  })

  it('allows bookId on pattern transforms (book-scoped)', () => {
    expect(transformCreateSchema.safeParse({ matchType: 'pattern', pattern: 'x', bookId: 'b1' }).success).toBe(true)
  })

  it('rejects invalid regex when isRegex is true', () => {
    expect(transformCreateSchema.safeParse({ pattern: '([', isRegex: true }).success).toBe(false)
    expect(transformCreateSchema.safeParse({ pattern: '([', isRegex: false }).success).toBe(true)
    expect(transformCreateSchema.safeParse({ pattern: '\\d+', isRegex: true }).success).toBe(true)
  })

  it('requires anchors and bookId for point transforms', () => {
    expect(transformCreateSchema.safeParse({ matchType: 'point' }).success).toBe(false)
    expect(transformCreateSchema.safeParse({
      matchType: 'point',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
    }).success).toBe(false)
    const ok = transformCreateSchema.safeParse({
      matchType: 'point',
      bookId: 'b1',
      spineHref: 'chapter1.xhtml',
      textOffset: 42,
      originalText: 'typo',
      replacement: 'fixed',
    })
    expect(ok.success).toBe(true)
  })

  it('accepts a partial update and the enabled toggle', () => {
    expect(transformUpdateSchema.safeParse({ enabled: false }).success).toBe(true)
    expect(transformUpdateSchema.safeParse({}).success).toBe(true)
  })

  it('validates the override request shape', () => {
    expect(transformOverrideSchema.safeParse({ bookId: 'b1', enabled: true }).success).toBe(true)
    expect(transformOverrideSchema.safeParse({ bookId: 'b1', enabled: null }).success).toBe(true)
    expect(transformOverrideSchema.safeParse({ bookId: 'b1' }).success).toBe(false)
    expect(transformOverrideSchema.safeParse({ enabled: true }).success).toBe(false)
  })
})
