import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { errorHandler } from '../../middleware/error'
import { createId } from '../../lib/id'
import ttsRoutes from './tts.routes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

interface TestUser {
  id: string
  username: string
  role: 'owner' | 'member' | 'guest'
}

describe('tts routes', () => {
  let db: ReturnType<typeof createTestDb>
  let owner: TestUser
  let member: TestUser
  let guest: TestUser

  function seedUser(username: string, role: TestUser['role']): TestUser {
    const user = { id: createId('user'), username, role }
    db.insert(schema.users).values({ ...user, createdAt: Date.now() }).run()
    return user
  }

  function createApp(user: TestUser) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/tts/*', async (c, next) => {
      c.set('user', { ...user, avatarKey: null })
      return next()
    })
    app.route('/api/v1/tts', ttsRoutes)
    return app
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    owner = seedUser('owner', 'owner')
    member = seedUser('member', 'member')
    guest = seedUser('guest', 'guest')
  })

  it('lists one merged OpenAI-compatible provider without a default model', async () => {
    const response = await createApp(owner).request('http://test/api/v1/tts/providers')

    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<Record<string, unknown>> }
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', kind: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null }),
    ]))
    expect(body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'openai-compatible' })]))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores multiple named services per user without returning credentials', async () => {
    const app = createApp(owner)
    const first = await app.request('http://test/api/v1/tts/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenAI 主服务', provider: 'openai', model: 'gpt-4o-mini-tts', defaultVoice: 'alloy', secrets: { apiKey: 'secret-key' } }),
    })
    expect(first.status).toBe(201)
    const second = await app.request('http://test/api/v1/tts/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '兼容网关', provider: 'openai-compatible', baseUrl: 'https://tts.example.test/v1', model: 'voice-model', secrets: { apiKey: 'another-secret' } }),
    })
    expect(second.status).toBe(201)

    const list = await app.request('http://test/api/v1/tts/services')
    const body = await list.json() as { data: Array<Record<string, unknown>> }
    expect(body.data).toHaveLength(2)
    expect(body.data.find((service) => service.name === '兼容网关')?.provider).toBe('openai')
    expect(body.data[0]).not.toHaveProperty('secrets')
    expect(body.data[0]).toHaveProperty('credentialsConfigured', true)

    const stored = db.select().from(schema.ttsServices).all()
    expect(stored).toHaveLength(2)
    expect(stored.find((service) => service.name === '兼容网关')?.provider).toBe('openai')
    expect(stored.every((row) => row.encryptedSecrets && !row.encryptedSecrets.includes('secret'))).toBe(true)
    const memberList = await createApp(member).request('http://test/api/v1/tts/services')
    expect((await memberList.json() as { data: unknown[] }).data).toEqual([])
  })

  it('does not expose or mutate AI services for guests', async () => {
    const app = createApp(guest)
    const list = await app.request('http://test/api/v1/tts/services')
    expect((await list.json() as { data: unknown[] }).data).toEqual([])
    const response = await app.request('http://test/api/v1/tts/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Guest service', provider: 'openai', secrets: { apiKey: 'secret' } }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'TTS_NOT_ALLOWED' } })
  })

  it('requires provider-specific credentials before creating a service', async () => {
    const response = await createApp(owner).request('http://test/api/v1/tts/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete', provider: 'aliyun', secrets: { appKey: 'only-one' } }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'TTS_NOT_CONFIGURED' } })
  })

  it('tests a draft service without storing it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await createApp(owner).request('http://test/api/v1/tts/services/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Draft gateway', provider: 'openai-compatible', baseUrl: 'https://tts.example.test/v1', model: 'voice-model', defaultVoice: 'alloy', secrets: { apiKey: 'secret-key' } }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true } })
    expect(db.select().from(schema.ttsServices).all()).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledWith('https://tts.example.test/v1/audio/speech', expect.anything())
  })

  it('decrypts the selected service and forwards the OpenAI-compatible request', async () => {
    const create = await createApp(owner).request('http://test/api/v1/tts/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gateway', provider: 'openai-compatible', baseUrl: 'https://tts.example.test/v1', model: 'voice-model', secrets: { apiKey: 'secret-key' } }),
    })
    const serviceId = (await create.json() as { data: { id: string } }).data.id
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await createApp(owner).request('http://test/api/v1/tts/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId, text: '你好', voice: 'alloy', rate: 1.2 }),
    })
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledWith('https://tts.example.test/v1/audio/speech', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
    }))
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'voice-model', input: '你好', voice: 'alloy', speed: 1.2 })
  })

  it('validates the built-in Edge speech request before contacting the provider', async () => {
    const response = await createApp(guest).request('http://test/api/v1/tts/edge/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
})
