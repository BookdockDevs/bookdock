import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../db/migration-stage'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RULE_TRANSFER_MAX_BYTES } from '@bookdock/shared'

import * as client from '../db/client'
import * as schema from '../db/legacy-test-schema'
import { errorHandler } from '../middleware/error'
import replacementRoutes from '../modules/replacements/replacements.routes'
import { importReplacements } from '../modules/replacements/replacements.service'
import tocRoutes from '../modules/toc-rules/toc-rules.routes'
import { importTocRules } from '../modules/toc-rules/toc-rules.service'

describe('rule transfer failure boundaries', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    db.insert(schema.users).values({ id: 'u', username: 'review', role: 'owner', createdAt: 1 }).run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sqlite.close()
  })

  function appFor(kind: 'toc' | 'replacement', guest = false) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', guest ? null : { id: 'u', username: 'review', role: guest ? 'guest' : 'owner', avatarKey: null })
      c.set('guest', guest)
      await next()
    })
    app.route('/rules', kind === 'toc' ? tocRoutes : replacementRoutes)
    return app
  }

  const tocFile = (name: string) => ({
    kind: 'bookdock.toc-rules', formatVersion: 1,
    rules: [{ name, enabled: true, patterns: [{ level: 1, regex: '^chapter', replacement: null, enabled: true }] }],
  })

  it('does not initialize rules or settings for an invalid first TOC import', () => {
    expect(() => importTocRules('u', { kind: 'wrong' })).toThrow()
    expect(db.select().from(schema.tocRules).all()).toEqual([])
    expect(db.select().from(schema.settings).all()).toEqual([])
  })

  it('rolls back initialization and all rows when a database insert fails', () => {
    sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON toc_rules WHEN NEW.name = 'bad-write' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    expect(() => importTocRules('u', tocFile('bad-write'))).toThrow()
    expect(db.select().from(schema.tocRules).all()).toEqual([])
    expect(db.select().from(schema.settings).all()).toEqual([])
  })

  it('allows a global import to reuse a book-scoped rule name', async () => {
    db.insert(schema.books).values({ id: 'b', userId: 'u', title: 'Test', author: 'Author', format: 'txt', filePath: 'test.txt', size: 1, meta: {}, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.bookVersions).values({ id: 'b', format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.textReplacements).values({ id: 'scoped', userId: 'u', bookId: 'b', name: 'shared-name', pattern: 'x', createdAt: 1, updatedAt: 1 }).run()
    const imported = await importReplacements('u', {
      kind: 'bookdock.text-replacements', formatVersion: 1,
      rules: [{ name: 'shared-name', pattern: 'y' }],
    })
    expect(imported[0]).toMatchObject({ name: 'shared-name', bookId: null, enabled: false })
    expect(db.select().from(schema.textReplacements).all()).toHaveLength(2)
  })

  it('preserves UTF-8 characters split between streamed request chunks', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(tocFile('中文')))
    const split = bytes.indexOf(0xe4) + 1
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, split))
      controller.enqueue(bytes.slice(split))
      controller.close()
    } })
    const request = new Request('http://test/rules/import', { method: 'POST', body, duplex: 'half' } as RequestInit)
    const response = await appFor('toc').request(request)
    expect(response.status).toBe(201)
    expect((await response.json()).data[0].name).toBe('中文')
  })

  for (const kind of ['toc', 'replacement'] as const) {
    it(`${kind}: rejects oversized actual bytes without trusting Content-Length`, async () => {
      const app = appFor(kind)
      for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'content-length': '1' }]) {
        const res = await app.request('/rules/import', { method: 'POST', headers, body: 'x'.repeat(RULE_TRANSFER_MAX_BYTES + 1) })
        expect(res.status).toBe(413)
        expect((await res.json()).error.code).toBe('UPLOAD_TOO_LARGE')
      }
      expect(db.select().from(schema.tocRules).all()).toEqual([])
      expect(db.select().from(schema.textReplacements).all()).toEqual([])
    })

    it(`${kind}: reports malformed JSON as validation failure and rejects guests`, async () => {
      const res = await appFor(kind).request('/rules/import', { method: 'POST', body: '{bad' })
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
      const guest = await appFor(kind, true).request('/rules/import', { method: 'POST', body: '{}' })
      expect(guest.status).toBe(403)
      expect(db.select().from(schema.settings).all()).toEqual([])
    })
  }
})
