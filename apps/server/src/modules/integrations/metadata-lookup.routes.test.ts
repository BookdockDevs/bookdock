import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { errorHandler } from '../../middleware/error'
import routes from './metadata-lookup.routes'
import { getPersonalSourceDetail, searchPersonalSource } from './personal-source.service'
import { searchWeRead } from './weread.service'

vi.mock('./metadata-lookup.service', () => ({
  metadataConfiguration: vi.fn(() => ({ googlebooks: true })),
  updateMetadataSecret: vi.fn(() => ({ googlebooks: true })),
  searchMetadata: vi.fn(async () => []),
  getDoubanMetadata: vi.fn(async (id: string) => ({ id, provider: 'douban' })),
  fetchMetadataCover: vi.fn(),
}))
vi.mock('./weread.service', () => ({
  getWeReadKey: vi.fn(() => 'test-key'),
  getWeReadMetadata: vi.fn(),
  searchWeRead: vi.fn(async () => []),
}))
vi.mock('./personal-source.service', () => ({
  searchPersonalSource: vi.fn(async () => [{ id: '1', provider: 'personal:my-source', title: 'T', authors: [], sourceUrl: '' }]),
  getPersonalSourceDetail: vi.fn(async () => null),
}))

function appFor(role: 'owner' | 'member' | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user', role ? { id: role, username: role, role, avatarKey: null } : null)
    c.set('guest', role === null)
    await next()
  })
  app.route('/metadata', routes)
  return app
}

describe('metadata lookup permissions', () => {
  it('rejects guests and lets members configure their own credentials', async () => {
    expect((await appFor(null).request('/metadata/config')).status).toBe(401)
    const member = appFor('member')
    expect((await member.request('/metadata/config')).status).toBe(200)
    expect((await member.request('/metadata/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'googlebooks', key: 'secret' }) })).status).toBe(200)
    expect((await member.request('/metadata/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'weread', key: 'secret' }) })).status).toBe(200)
  })

  it('allows the owner to configure a key and rejects arbitrary providers', async () => {
    const owner = appFor('owner')
    const options = (provider: string) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, key: 'secret' }) })
    expect((await owner.request('/metadata/config', options('googlebooks'))).status).toBe(200)
    expect((await owner.request('/metadata/config', options('other'))).status).toBe(400)
  })

  it('requires login and a numeric Douban identifier for detail requests', async () => {
    const options = (id: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'douban', id }) })
    expect((await appFor(null).request('/metadata/detail', options('123'))).status).toBe(401)
    expect((await appFor('member').request('/metadata/detail', options('../secret'))).status).toBe(400)
    expect((await appFor('member').request('/metadata/detail', options('123'))).status).toBe(200)
  })

  it('passes the WeRead scope and rejects invalid scopes', async () => {
    const options = (weReadScope: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'weread', query: 'Book', weReadScope }) })
    const response = await appFor('member').request('/metadata/search', options('ebooks'))
    expect(await response.json()).toEqual({ data: [] })
    expect(searchWeRead).toHaveBeenCalledWith('test-key', 'Book', 'ebooks')
    expect((await appFor('member').request('/metadata/search', options('invalid'))).status).toBe(400)
  })

  it('dispatches personal providers to the personal source service', async () => {
    const app = appFor('member')
    const search = await app.request('/metadata/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'personal:my-source', query: 'Book' }) })
    expect(await search.json()).toEqual({ data: [{ id: '1', provider: 'personal:my-source', title: 'T', authors: [], sourceUrl: '' }] })
    expect(searchPersonalSource).toHaveBeenCalledWith('member', 'my-source', 'Book')
    expect((await app.request('/metadata/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'personal:BAD', query: 'Book' }) })).status).toBe(400)
    const detail = await app.request('/metadata/detail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'personal:my-source', id: '1' }) })
    expect(await detail.json()).toEqual({ data: null })
    expect(getPersonalSourceDetail).toHaveBeenCalledWith('member', 'my-source', '1')
  })
})
