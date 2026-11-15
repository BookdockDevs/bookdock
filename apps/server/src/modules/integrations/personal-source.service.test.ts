import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirementIncluding } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import { createId } from '../../lib/id'
import { getPersonalSourceDetail, listPersonalSources, searchPersonalSource } from './personal-source.service'
import { installPersonalSourceFromZip } from './personal-source-install'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { Readable } from 'node:stream'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirementIncluding(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, [
    '0058_personal_metadata_sources',
  ])
  return db
}

function seedUser(db: ReturnType<typeof createTestDb>, username: string): string {
  const id = createId('user')
  db.insert(schema.users).values({ id, username, passwordHash: null, role: 'owner', createdAt: 1 }).run()
  return id
}

function seedSource(db: ReturnType<typeof createTestDb>, userId: string, sourceId: string, createdAt: number) {
  db.insert(schema.personalMetadataSources)
    .values({
      id: createId('psrc'),
      userId,
      sourceId,
      name: sourceId,
      version: '0.1.0',
      apiVersion: 1,
      originType: 'zip',
      entryPath: 'entry.js',
      hasDetail: true,
      createdAt,
      updatedAt: createdAt,
    })
    .run()
}

describe('listPersonalSources ordering', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = seedUser(db, 'owner')
  })

  it('lists sources by install time, not by the unique index order', () => {
    // Insert in an order where alphabetical sourceId order differs from
    // install order; the (user_id, source_id) index alone would scan a-y-z.
    seedSource(db, userId, 'zeta', 300)
    seedSource(db, userId, 'alpha', 100)
    seedSource(db, userId, 'yoke', 200)

    expect(listPersonalSources(userId).map((source) => source.sourceId)).toEqual(['alpha', 'yoke', 'zeta'])
  })

  it('breaks createdAt ties by sourceId', () => {
    seedSource(db, userId, 'beta', 100)
    seedSource(db, userId, 'alpha', 100)

    expect(listPersonalSources(userId).map((source) => source.sourceId)).toEqual(['alpha', 'beta'])
  })

  it('never lists another user’s sources', () => {
    seedSource(db, userId, 'mine', 100)
    const otherId = seedUser(db, 'other')
    seedSource(db, otherId, 'theirs', 100)

    expect(listPersonalSources(userId).map((source) => source.sourceId)).toEqual(['mine'])
  })
})

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) files.set(key, data)
      else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
        files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(buf)
    },
    async delete(key) { files.delete(key) },
    async exists(key) { return files.has(key) },
    async size(key) { return files.get(key)?.length ?? 0 },
  }
  return { driver, files }
}

async function sourceZip(id: string, version: string, withIcon: boolean, entry = 'export default { async search() { return [] } }'): Promise<File> {
  const manifest = JSON.stringify({ id, name: id, version, apiVersion: 1, entry: 'index.js', ...(withIcon ? { icon: 'icon.png' } : {}) })
  const zip = new JSZip()
  zip.file('manifest.json', manifest)
  zip.file('index.js', entry)
  if (withIcon) zip.file('icon.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  return new File([buffer], `${id}.zip`)
}

describe('personal source overwrite install', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string
  let files: Map<string, Buffer>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)
    userId = seedUser(db, 'owner')
  })

  it('overwrites an existing source ID in place, keeping createdAt', async () => {
    const first = await installPersonalSourceFromZip(userId, await sourceZip('my-source', '0.1.0', true))
    expect(first.version).toBe('0.1.0')
    expect(first.hasIcon).toBe(true)
    const createdAt = first.createdAt

    const second = await installPersonalSourceFromZip(userId, await sourceZip('my-source', '0.2.0', false))
    expect(second.version).toBe('0.2.0')
    expect(second.hasIcon).toBe(false)
    expect(second.createdAt).toBe(createdAt)

    const rows = listPersonalSources(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sourceId: 'my-source', version: '0.2.0', hasIcon: false, createdAt })
    expect(files.has(`sources/${userId}/my-source/entry.js`)).toBe(true)
    // The stale icon must be gone when the new package ships none.
    expect(files.has(`sources/${userId}/my-source/icon`)).toBe(false)
  })

  it('does not touch another user’s source with the same ID', async () => {
    await installPersonalSourceFromZip(userId, await sourceZip('shared-id', '0.1.0', false))
    const otherId = seedUser(db, 'other')
    await installPersonalSourceFromZip(otherId, await sourceZip('shared-id', '0.9.0', false))
    expect(listPersonalSources(userId)[0]?.version).toBe('0.1.0')
    expect(listPersonalSources(otherId)[0]?.version).toBe('0.9.0')
  })
})

describe('personal source candidate adaptation', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    userId = seedUser(db, 'owner')
  })

  // A search-only source is the only chance to carry classification: it never
  // gets a detail request, so the host adaptation must not drop these fields.
  it('keeps classification and series fields from a search-only source', async () => {
    const entry = `
      export default {
        async search() {
          return [{ id: '1', title: ' Book ', category: ' 玄幻 ', tags: ['爽文', '爽文', '无限流'], series: ' Series ', seriesIndex: '2' }]
        },
      }
    `
    await installPersonalSourceFromZip(userId, await sourceZip('classifier', '0.1.0', false, entry))
    const [candidate] = await searchPersonalSource(userId, 'classifier', 'book')
    expect(candidate).toMatchObject({
      id: '1',
      title: 'Book',
      category: '玄幻',
      tags: ['爽文', '无限流'],
      series: 'Series',
      seriesIndex: '2',
    })
  })

  // A protocol-relative URL would resolve against the Bookdock origin in the
  // browser and be rejected by the cover proxy, so it is normalized here.
  it('normalizes protocol-relative and http cover URLs', async () => {
    const entry = `
      export default {
        async search() {
          return [
            { id: '1', title: 'Relative', coverUrl: '//cdn.example.com/a.jpg' },
            { id: '2', title: 'Plain', coverUrl: 'http://cdn.example.com/b.jpg' },
            { id: '3', title: 'Port', coverUrl: 'https://cdn.example.com:8443/c.jpg' },
            { id: '4', title: 'None', coverUrl: 'not a url' },
          ]
        },
      }
    `
    await installPersonalSourceFromZip(userId, await sourceZip('covers', '0.1.0', false, entry))
    const candidates = await searchPersonalSource(userId, 'covers', 'book')
    expect(candidates.map((candidate) => candidate.coverUrl)).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      undefined,
      undefined,
    ])
  })

  it('applies the same bounds and cover normalization to detail values', async () => {
    const entry = `
      export default {
        async search() { return [] },
        async getDetail() {
          return { description: 'x'.repeat(25000), coverUrl: '//cdn.example.com/d.jpg', tags: [' a ', 'a', 'b'], series: ' S ' }
        },
      }
    `
    await installPersonalSourceFromZip(userId, await sourceZip('detail-bounds', '0.1.0', false, entry))
    const detail = await getPersonalSourceDetail(userId, 'detail-bounds', '1')
    expect(detail?.description).toHaveLength(20_000)
    expect(detail?.coverUrl).toBe('https://cdn.example.com/d.jpg')
    expect(detail?.tags).toEqual(['a', 'b'])
    expect(detail?.series).toBe('S')
  })
})
