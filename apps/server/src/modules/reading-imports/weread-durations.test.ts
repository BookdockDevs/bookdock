import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
vi.hoisted(() => { process.env.JWT_SECRET = 'test-secret' })

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import {
  clearWereadWebSession,
  getWereadQrLoginStatus,
  getWereadWebCredential,
  getWereadWebSessionStatus,
  refreshWereadWebCredential,
  runWereadWebSessionKeepAlive,
  saveWereadWebSession,
  startWereadQrLogin,
  verifyWereadWebSession,
} from './weread-durations'

const fetchMock = vi.fn()

type TestDb = ReturnType<typeof drizzle<typeof schema>>

describe('weread web session storage', () => {
  let db: TestDb
  let userId: string

  beforeEach(async () => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: 'reader', createdAt: Date.now() }).run()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stores, reports, restores and clears the session', () => {
    expect(getWereadWebSessionStatus(userId)).toEqual({ configured: false, vid: null, updatedAt: null, valid: true })

    const saved = saveWereadWebSession(userId, 'Cookie: wr_vid=306734116; wr_skey=pmguPsOm; wr_rt=web%40x')
    expect(saved).toMatchObject({ configured: true, vid: '306734116' })
    expect(getWereadWebSessionStatus(userId)).toMatchObject({ configured: true, vid: '306734116' })

    // The stored value is ciphertext on its own settings key, never plain text
    // and never merged with the read-only key settings.
    const row = db.select().from(schema.settings)
      .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, 'weread-web-session'))).get()!
    expect(String(row.value)).not.toContain('wr_skey')
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'pmguPsOm' })

    clearWereadWebSession(userId)
    expect(getWereadWebSessionStatus(userId).configured).toBe(false)
    expect(getWereadWebCredential(userId)).toBeNull()
  })

  it('treats a stored value that no longer parses as absent', () => {
    db.insert(schema.settings).values({
      id: createId('setting'), userId, key: 'weread-web-session', value: { cookie: 'not-a-cookie' },
    }).run()
    expect(getWereadWebCredential(userId)).toBeNull()
    expect(getWereadWebSessionStatus(userId).configured).toBe(true)
  })

  it('completes a caller-bound QR login and stores the final cookies encrypted', async () => {
    const loginResponse = (body: unknown, cookies: string[] = []) => {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      for (const cookie of cookies) headers.append('Set-Cookie', cookie)
      return new Response(JSON.stringify(body), { status: 200, headers })
    }
    fetchMock
      .mockResolvedValueOnce(loginResponse({ uid: 'one-time-uid' }, ['login_bootstrap=1; Path=/']))
      .mockResolvedValueOnce(loginResponse({ vid: 306734116, skey: 'access', code: 'refresh' }))
      .mockResolvedValueOnce(loginResponse({ succ: 1 }))
      .mockResolvedValueOnce(loginResponse({ succ: 1 }, [
        'wr_vid=306734116; Path=/; HttpOnly',
        'wr_skey=secret; Path=/; HttpOnly',
      ]))

    const started = await startWereadQrLogin(userId)
    expect(started.confirmUrl).toContain('uid=one-time-uid')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>).Cookie).toBe('login_bootstrap=1')

    await vi.waitFor(() => expect(getWereadQrLoginStatus(userId, started.id).status).toBe('complete'))
    expect(getWereadQrLoginStatus(userId, started.id).session).toMatchObject({ configured: true, vid: '306734116' })
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'secret' })
    expect(() => getWereadQrLoginStatus(createId('other'), started.id)).toThrowError(AppError)
  })

  it('reports a sanitized QR exchange failure stage and reason', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'one-time-uid' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ errCode: -7, errMsg: 'sensitive upstream text' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const started = await startWereadQrLogin(userId)
    await vi.waitFor(() => expect(getWereadQrLoginStatus(userId, started.id).status).toBe('failed'))
    expect(getWereadQrLoginStatus(userId, started.id).failure).toEqual({
      stage: 'getinfo',
      kind: 'api-error',
      upstreamCode: -7,
    })
    expect(JSON.stringify(getWereadQrLoginStatus(userId, started.id))).not.toContain('sensitive upstream text')
  })

  it('reports only field names and value types when getinfo lacks required credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'one-time-uid' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      info: { vid: 306734116, accessToken: 'private-access-token' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const started = await startWereadQrLogin(userId)
    await vi.waitFor(() => expect(getWereadQrLoginStatus(userId, started.id).status).toBe('failed'))
    const status = getWereadQrLoginStatus(userId, started.id)
    expect(status.failure).toMatchObject({
      stage: 'getinfo',
      kind: 'missing-credentials',
      observedFields: ['info:object', 'info.vid:number', 'info.accessToken:string'],
    })
    expect(JSON.stringify(status)).not.toContain('private-access-token')
  })
})

describe('weread web session verification and keep-alive', () => {
  let db: TestDb
  let userId: string

  const probeResponse = (body: unknown, cookies: string[] = [], status = 200) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const cookie of cookies) headers.append('Set-Cookie', cookie)
    return new Response(JSON.stringify(body), { status, headers })
  }

  beforeEach(async () => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: 'reader', createdAt: Date.now() }).run()
    saveWereadWebSession(userId, 'wr_vid=306734116; wr_skey=pmguPsOm')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('skips the upstream probe while a verification is still fresh', async () => {
    const status = await verifyWereadWebSession(userId)
    expect(status).toMatchObject({ configured: true, valid: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('absorbs a rotated skey from a successful probe and stays valid', async () => {
    fetchMock.mockResolvedValueOnce(probeResponse({ errCode: 0, books: [] }, ['wr_skey=rotated; Path=/; HttpOnly']))
    const status = await verifyWereadWebSession(userId, 0)
    expect(status).toMatchObject({ configured: true, valid: true })
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'rotated' })
  })

  it('marks the session invalid on a definitive rejection but keeps the cookie', async () => {
    fetchMock.mockResolvedValueOnce(probeResponse({ errCode: -2012 }))
    const status = await verifyWereadWebSession(userId, 0)
    expect(status).toMatchObject({ configured: true, valid: false })
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'pmguPsOm' })

    // Keep-alive never spends requests on a session that is already dead.
    fetchMock.mockClear()
    await runWereadWebSessionKeepAlive()
    expect(fetchMock).not.toHaveBeenCalled()

    // A later successful verification revives the stored session.
    fetchMock.mockResolvedValueOnce(probeResponse({ errCode: 0, books: [] }))
    await verifyWereadWebSession(userId, 0)
    expect(getWereadWebSessionStatus(userId)).toMatchObject({ configured: true, valid: true })
  })

  it('keeps the stored validity when the probe cannot tell', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const status = await verifyWereadWebSession(userId, 0)
    expect(status).toMatchObject({ configured: true, valid: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('persists only credential changes through the rotation callback', () => {
    refreshWereadWebCredential(userId, { vid: '306734116', skey: 'pmguPsOm' })
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'pmguPsOm' })

    refreshWereadWebCredential(userId, { vid: '306734116', skey: 'next-skey' })
    expect(getWereadWebCredential(userId)).toEqual({ vid: '306734116', skey: 'next-skey' })
    expect(getWereadWebSessionStatus(userId)).toMatchObject({ configured: true, valid: true })
  })
})
