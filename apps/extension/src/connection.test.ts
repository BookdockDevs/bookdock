import { afterEach, describe, expect, it, vi } from 'vitest'

import { testConnection, testConnectionOnce } from './connection'

const token = `bd_${'a'.repeat(43)}`
const me = { id: 'user_1', username: 'reader', role: 'member', guest: false, tokenPermissions: ['ext:upload'] }
const instance = { initialized: true, uploadMaxBytes: 100, allowUserUpload: true }

describe('connection identity and scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  function respond(identity: unknown = me, settings: unknown = instance) {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({ data: url.endsWith('/me') ? identity : settings })))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('uses the token only for identity, omits cookies, and refuses redirects', async () => {
    const fetch = respond()
    expect(await testConnection('https://books.example.com/', token)).toMatchObject({ userId: 'user_1', username: 'reader', uploadMaxBytes: 100 })
    expect(fetch).toHaveBeenCalledWith('https://books.example.com/api/v1/auth/me', expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${token}` } }))
    expect(fetch).toHaveBeenCalledWith('https://books.example.com/api/v1/auth/instance', expect.not.objectContaining({ headers: expect.anything() }))
  })

  it('rejects guests and tokens without upload scope before saving', async () => {
    // The server never issues tokens to guests, so a guest reply means the token is unusable.
    respond({ user: null, guest: true })
    await expect(testConnection('https://books.example.com', token)).rejects.toThrow('令牌无效')
    respond({ ...me, tokenPermissions: [] })
    await expect(testConnection('https://books.example.com', token)).rejects.toThrow('上传书籍')
  })

  it('honors the instance member-upload switch while allowing the owner', async () => {
    respond(me, { ...instance, allowUserUpload: false })
    await expect(testConnection('https://books.example.com', token)).rejects.toThrow('管理员')
    respond({ ...me, role: 'owner' }, { ...instance, allowUserUpload: false })
    await expect(testConnection('https://books.example.com', token)).resolves.toMatchObject({ userId: 'user_1' })
  })

  it('does not put credentials or server response bodies into connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: token } }), { status: 401 })))
    await expect(testConnection('https://books.example.com', token)).rejects.toThrow('令牌无效')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`network error ${token}`) }))
    await expect(testConnection('https://books.example.com', token)).rejects.toThrow('无法连接实例')
  })
})

describe('probe reuse across the files of one batch', () => {
  afterEach(() => vi.unstubAllGlobals())

  function respond() {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({ data: url.endsWith('/me') ? me : instance })))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('probes once however many files ask for the same connection', async () => {
    const fetch = respond()
    const results = await Promise.all([1, 2, 3].map(() => testConnectionOnce('https://batch.example.com', token)))
    // One /me plus one /instance for the whole batch, not per file.
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(results.map((value) => value.userId)).toEqual(['user_1', 'user_1', 'user_1'])
  })

  it('does not cache a failure, so the next file retries the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(testConnectionOnce('https://retry.example.com', token)).rejects.toThrow('无法连接实例')
    const retry = respond()
    await expect(testConnectionOnce('https://retry.example.com', token)).resolves.toMatchObject({ userId: 'user_1' })
    expect(retry).toHaveBeenCalledTimes(2)
  })
})
