import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { errorHandler } from '../../middleware/error'
import routes from './personal-source.routes'
import * as install from './personal-source-install'
import * as service from './personal-source.service'

vi.mock('./personal-source-install', () => ({
  installPersonalSourceFromGitHub: vi.fn(),
  installPersonalSourceFromZip: vi.fn(),
}))
vi.mock('./personal-source.service', () => ({
  listPersonalSources: vi.fn(() => []),
  removePersonalSource: vi.fn(),
  getPersonalSourceIcon: vi.fn(),
}))

function createApp(userId: string | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/integrations/personal-sources/*', async (c, next) => {
    c.set('user', userId ? { id: userId, username: userId, role: 'owner', avatarKey: null } : null)
    c.set('guest', !userId)
    await next()
  })
  app.route('/api/v1/integrations/personal-sources', routes)
  return app
}

describe('personal metadata source routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects guests and lists the user sources', async () => {
    expect((await createApp(null).request('/api/v1/integrations/personal-sources')).status).toBe(401)
    const response = await createApp('u1').request('/api/v1/integrations/personal-sources')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [] })
    expect(service.listPersonalSources).toHaveBeenCalledWith('u1')
  })

  it('installs from GitHub and validates the request body', async () => {
    vi.mocked(install.installPersonalSourceFromGitHub).mockResolvedValue({
      sourceId: 'example-books', name: 'Example Books', version: '1.0.0', originType: 'github', hasIcon: false, createdAt: 1,
    })
    const app = createApp('u1')
    const bad = await app.request('/api/v1/integrations/personal-sources/install/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: '' }) })
    expect(bad.status).toBe(400)
    const good = await app.request('/api/v1/integrations/personal-sources/install/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://github.com/octo/hello' }) })
    expect(good.status).toBe(200)
    expect(install.installPersonalSourceFromGitHub).toHaveBeenCalledWith('u1', 'https://github.com/octo/hello')
  })

  it('requires a ZIP file upload for package installs', async () => {
    const app = createApp('u1')
    const missing = await app.request('/api/v1/integrations/personal-sources/install/zip', { method: 'POST' })
    expect(missing.status).toBe(400)
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1])], 'source.zip', { type: 'application/zip' }))
    vi.mocked(install.installPersonalSourceFromZip).mockRejectedValue(new (await import('../../middleware/error')).AppError('PERSONAL_SOURCE_INVALID_PACKAGE', 'bad package'))
    const rejected = await app.request('/api/v1/integrations/personal-sources/install/zip', { method: 'POST', body: form })
    expect(rejected.status).toBe(400)
    expect(install.installPersonalSourceFromZip).toHaveBeenCalled()
  })

  it('deletes an owned source and serves its icon', async () => {
    const app = createApp('u1')
    expect((await app.request('/api/v1/integrations/personal-sources/example-books', { method: 'DELETE' })).status).toBe(200)
    expect(service.removePersonalSource).toHaveBeenCalledWith('u1', 'example-books')
    vi.mocked(service.getPersonalSourceIcon).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: 'image/png' })
    const icon = await app.request('/api/v1/integrations/personal-sources/example-books/icon')
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png')
  })
})
