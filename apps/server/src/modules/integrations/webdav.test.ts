import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from '../../middleware/error'
import webdavRoutes from './webdav.routes'
import * as webdavService from './webdav.service'
import { AppError } from '../../middleware/error'

vi.mock('./webdav.service', () => ({
  deleteWebDavConfig: vi.fn(),
  getWebDavConfig: vi.fn(),
  updateWebDavConfig: vi.fn(),
  testWebDavConnection: vi.fn(),
  listWebDavFiles: vi.fn(),
  importWebDavBooks: vi.fn(),
}))

function createApp(user: { id: string; username: string; role: string } | null = { id: 'u1', username: 'tester', role: 'owner' }) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/integrations/webdav/*', async (c, next) => {
    c.set('user', user ? { ...user, avatarKey: null } : null)
    return next()
  })
  app.route('/api/v1/integrations/webdav', webdavRoutes)
  return app
}

describe('WebDAV routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests', async () => {
    const app = createApp(null)
    const res = await app.request('/api/v1/integrations/webdav/config')
    expect(res.status).toBe(401)
  })

  it('GET /config returns user config', async () => {
    vi.mocked(webdavService.getWebDavConfig).mockReturnValue({
      configured: true,
      url: 'https://dav.test.com',
      username: 'user1',
      basePath: '/books',
      hasPassword: true,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/config')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({
      configured: true,
      url: 'https://dav.test.com',
      username: 'user1',
      basePath: '/books',
      hasPassword: true,
    })
  })

  it('DELETE /config clears user config', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/config', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(webdavService.deleteWebDavConfig).toHaveBeenCalledWith('u1')
  })

  it('PUT /config updates config with validation', async () => {
    vi.mocked(webdavService.updateWebDavConfig).mockReturnValue({
      enabled: true,
      url: 'https://dav.test.com/new',
      username: 'user2',
      basePath: '/',
      hasPassword: true,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://dav.test.com/new',
        username: 'user2',
        password: 'new-password',
      }),
    })

    expect(res.status).toBe(200)
    expect(webdavService.updateWebDavConfig).toHaveBeenCalledWith('u1', {
      url: 'https://dav.test.com/new',
      username: 'user2',
      password: 'new-password',
    })
  })

  it('POST /test calls testWebDavConnection', async () => {
    vi.mocked(webdavService.testWebDavConnection).mockResolvedValue({
      success: true,
      latencyMs: 120,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://dav.test.com' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ success: true, latencyMs: 120 })
  })

  it('POST /ls lists files', async () => {
    vi.mocked(webdavService.listWebDavFiles).mockResolvedValue([
      { name: 'book.epub', path: '/book.epub', type: 'file', size: 1024, isSupported: true },
    ])

    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/ls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('book.epub')
  })

  it('POST /import invokes importWebDavBooks', async () => {
    vi.mocked(webdavService.importWebDavBooks).mockResolvedValue({
      results: [
        { path: '/b.epub', name: 'b.epub', status: 'success', bookId: 'bk_1' },
      ],
      total: 1,
      successCount: 1,
      duplicateCount: 0,
      errorCount: 0,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/webdav/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: ['/b.epub'],
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.successCount).toBe(1)
  })

  it('POST /import propagates 403 when upload is disabled', async () => {
    vi.mocked(webdavService.importWebDavBooks).mockRejectedValue(
      new AppError('FORBIDDEN', 'Uploads are disabled by the instance owner'),
    )

    const app = createApp({ id: 'member_1', username: 'member', role: 'member' })
    const res = await app.request('/api/v1/integrations/webdav/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: ['/b.epub'],
      }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('FORBIDDEN')
  })
})
