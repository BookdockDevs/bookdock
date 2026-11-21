import { Readable } from 'node:stream'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../db/schema'
import { errorHandler } from '../../middleware/error'
import readingThemeRoutes from './reading-themes.routes'

const storageState = vi.hoisted(() => ({ files: new Map<string, Buffer>() }))

vi.mock('../../db/client', () => ({ getDb: () => currentDb }))
vi.mock('../../storage', () => ({
  getStorage: () => ({
    exists: async (key: string) => storageState.files.has(key),
    put: async (key: string, data: Buffer) => { storageState.files.set(key, Buffer.from(data)) },
    get: async (key: string) => Readable.from(storageState.files.get(key)!),
    delete: async (key: string) => { storageState.files.delete(key) },
  }),
}))

let currentDb: ReturnType<typeof drizzle<typeof schema>>

interface TestUser {
  id: string
  username: string
  role: 'owner' | 'member'
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

function createApp(currentUser: TestUser | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/reading-themes/*', async (c, next) => {
    if (currentUser) {
      c.set('user', { id: currentUser.id, username: currentUser.username, role: currentUser.role, avatarKey: null })
      c.set('guest', false)
    } else {
      c.set('guest', true)
    }
    return next()
  })
  app.route('/api/v1/reading-themes', readingThemeRoutes)
  return app
}

describe('reading themes & assets routes', () => {
  const owner: TestUser = { id: 'owner-1', username: 'owner', role: 'owner' }
  const member: TestUser = { id: 'member-1', username: 'member', role: 'member' }

  beforeEach(() => {
    storageState.files.clear()
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    currentDb = drizzle(sqlite, { schema })
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('${owner.id}'), ('${member.id}');
      CREATE TABLE theme_assets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, asset_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'user', file_name TEXT NOT NULL, mime TEXT NOT NULL, content_hash TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX theme_assets_user_asset_unique ON theme_assets (user_id, asset_id);
      CREATE INDEX theme_assets_asset_scope_idx ON theme_assets (asset_id, scope);
      CREATE INDEX theme_assets_content_hash_idx ON theme_assets (content_hash);
      CREATE TABLE instance_theme_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, item_id TEXT NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX instance_theme_items_kind_item_unique ON instance_theme_items (kind, item_id);
    `)
  })

  it('syncs personal theme assets and keeps private assets isolated', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)

    const form = new FormData()
    form.append('assetId', 'asset-wall-1')
    form.append('width', '800')
    form.append('height', '600')
    form.append('file', new File([PNG_BYTES], 'wall.png', { type: 'image/png' }))

    const upload = await ownerApp.request('http://test/api/v1/reading-themes/assets', { method: 'POST', body: form })
    expect(upload.status).toBe(201)
    const { data: uploaded } = (await upload.json()) as { data: { assetId: string; scope: string } }
    expect(uploaded.assetId).toBe('asset-wall-1')
    expect(uploaded.scope).toBe('user')

    const ownerGet = await ownerApp.request('http://test/api/v1/reading-themes/assets/asset-wall-1')
    expect(ownerGet.status).toBe(200)
    expect(Buffer.from(await ownerGet.arrayBuffer()).equals(PNG_BYTES)).toBe(true)

    const memberGet = await memberApp.request('http://test/api/v1/reading-themes/assets/asset-wall-1')
    expect(memberGet.status).toBe(404)
  })

  it('lets only owner publish/remove instance themes and shares referenced assets', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    const guestApp = createApp(null)

    // Owner uploads a wallpaper asset first
    const form = new FormData()
    form.append('assetId', 'asset-shared-wall')
    form.append('file', new File([PNG_BYTES], 'shared.png', { type: 'image/png' }))
    await ownerApp.request('http://test/api/v1/reading-themes/assets', { method: 'POST', body: form })

    const publishBody = {
      items: [
        {
          kind: 'palette',
          itemId: 'pal-1',
          payload: { id: 'pal-1', name: 'Shared Palette', colors: { bg: '#ffffff', fg: '#111111', primary: '#222222' }, wallpaperAssetId: 'asset-shared-wall' },
        },
        {
          kind: 'theme',
          itemId: 'thm-1',
          payload: { id: 'thm-1', name: 'Shared Theme', cards: { paletteId: 'pal-1', cssId: null, highlightIds: [] } },
        },
      ],
      assetIds: ['asset-shared-wall'],
    }

    // Member cannot publish
    const denied = await memberApp.request('http://test/api/v1/reading-themes/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishBody),
    })
    expect(denied.status).toBe(403)

    // Owner publishes
    const published = await ownerApp.request('http://test/api/v1/reading-themes/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishBody),
    })
    expect(published.status).toBe(200)

    // Guest and member can read instance library and the referenced asset
    const guestLib = await guestApp.request('http://test/api/v1/reading-themes/instance')
    expect(guestLib.status).toBe(200)
    const { data: lib } = (await guestLib.json()) as { data: { palettes: unknown[]; themes: unknown[] } }
    expect(lib.palettes).toHaveLength(1)
    expect(lib.themes).toHaveLength(1)

    const guestAsset = await guestApp.request('http://test/api/v1/reading-themes/assets/asset-shared-wall')
    expect(guestAsset.status).toBe(200)
    expect(Buffer.from(await guestAsset.arrayBuffer()).equals(PNG_BYTES)).toBe(true)

    // Owner removes palette -> referenced asset demotes back to private
    const removed = await ownerApp.request('http://test/api/v1/reading-themes/instance/palette/pal-1', { method: 'DELETE' })
    expect(removed.status).toBe(200)
    const guestAssetAfter = await guestApp.request('http://test/api/v1/reading-themes/assets/asset-shared-wall')
    expect(guestAssetAfter.status).toBe(404)
  })
})
