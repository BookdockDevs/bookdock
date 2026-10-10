import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from '../../middleware/error'
import storageConnectionRoutes from './storage-connection.routes'
import * as storageService from './storage-connection.service'

vi.mock('./storage-connection.service', () => ({
  listStorageConnections: vi.fn(),
  getStorageConnection: vi.fn(),
  createStorageConnection: vi.fn(),
  updateStorageConnection: vi.fn(),
  deleteStorageConnection: vi.fn(),
  testDirectStorageConnection: vi.fn(),
  testStorageConnection: vi.fn(),
  listStorageConnectionFiles: vi.fn(),
  importStorageConnectionBooks: vi.fn(),
}))

function createApp(user: { id: string; username: string; role: string } | null = { id: 'u1', username: 'tester', role: 'owner' }) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/integrations/storage-connections/*', async (c, next) => {
    c.set('user', user ? { ...user, avatarKey: null } : null)
    return next()
  })
  app.route('/api/v1/integrations/storage-connections', storageConnectionRoutes)
  return app
}

describe('Storage connection routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests', async () => {
    const app = createApp(null)
    const res = await app.request('/api/v1/integrations/storage-connections')
    expect(res.status).toBe(401)
  })

  it('GET / returns list of connections', async () => {
    vi.mocked(storageService.listStorageConnections).mockReturnValue([
      {
        id: 'conn_1',
        name: 'My WebDAV',
        provider: 'webdav',
        endpoint: 'https://dav.test.com',
        username: 'user1',
        basePath: '/books',
        region: '',
        bucket: '',
        hasSecrets: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ])

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('conn_1')
    expect(storageService.listStorageConnections).toHaveBeenCalledWith('u1')
  })

  it('POST / creates a connection', async () => {
    vi.mocked(storageService.createStorageConnection).mockReturnValue({
      id: 'conn_2',
      name: 'New Drive',
      provider: 'webdav',
      endpoint: 'https://dav2.test.com',
      username: 'user2',
      basePath: '/',
      region: '',
      bucket: '',
      hasSecrets: true,
      createdAt: 2000,
      updatedAt: 2000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Drive',
        provider: 'webdav',
        endpoint: 'https://dav2.test.com',
        username: 'user2',
        password: 'secret-password',
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('conn_2')
    expect(storageService.createStorageConnection).toHaveBeenCalledWith('u1', {
      name: 'New Drive',
      provider: 'webdav',
      endpoint: 'https://dav2.test.com',
      username: 'user2',
      password: 'secret-password',
    })
  })

  it('POST / rejects invalid endpoint URL', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Drive',
        endpoint: 'not-a-valid-url',
        username: 'user',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('GET /:id returns connection details', async () => {
    vi.mocked(storageService.getStorageConnection).mockReturnValue({
      id: 'conn_1',
      name: 'My WebDAV',
      provider: 'webdav',
      endpoint: 'https://dav.test.com',
      username: 'user1',
      basePath: '/',
      region: '',
      bucket: '',
      hasSecrets: true,
      createdAt: 1000,
      updatedAt: 1000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe('conn_1')
    expect(storageService.getStorageConnection).toHaveBeenCalledWith('u1', 'conn_1')
  })

  it('PUT /:id updates connection', async () => {
    vi.mocked(storageService.updateStorageConnection).mockReturnValue({
      id: 'conn_1',
      name: 'Renamed WebDAV',
      provider: 'webdav',
      endpoint: 'https://dav.test.com',
      username: 'user1',
      basePath: '/',
      region: '',
      bucket: '',
      hasSecrets: true,
      createdAt: 1000,
      updatedAt: 2000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed WebDAV',
      }),
    })

    expect(res.status).toBe(200)
    expect(storageService.updateStorageConnection).toHaveBeenCalledWith('u1', 'conn_1', {
      name: 'Renamed WebDAV',
    })
  })

  it('DELETE /:id deletes connection', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1', {
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    expect(storageService.deleteStorageConnection).toHaveBeenCalledWith('u1', 'conn_1')
  })

  it('POST /test calls testDirectStorageConnection', async () => {
    vi.mocked(storageService.testDirectStorageConnection).mockResolvedValue({
      success: true,
      latencyMs: 88,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://dav.test.com',
        username: 'user1',
        password: 'pass',
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.success).toBe(true)
    expect(body.data.latencyMs).toBe(88)
  })

  it('POST /:id/test calls testStorageConnection', async () => {
    vi.mocked(storageService.testStorageConnection).mockResolvedValue({
      success: true,
      latencyMs: 95,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.success).toBe(true)
    expect(storageService.testStorageConnection).toHaveBeenCalledWith('u1', 'conn_1', {})
  })

  it('POST /:id/ls lists files for connection', async () => {
    vi.mocked(storageService.listStorageConnectionFiles).mockResolvedValue([
      {
        path: '/books/sample.epub',
        name: 'sample.epub',
        type: 'file',
        size: 1024,
        lastModified: 1000,
      },
    ])

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1/ls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/books' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(storageService.listStorageConnectionFiles).toHaveBeenCalledWith('u1', 'conn_1', '/books')
  })

  it('POST / rejects S3 connections without a bucket', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My S3',
        provider: 's3',
        endpoint: 'http://localhost:9000',
        username: 'minioadmin',
        password: 'minioadmin',
      }),
    })

    expect(res.status).toBe(400)
    expect(storageService.createStorageConnection).not.toHaveBeenCalled()
  })

  it('POST / creates an S3 connection', async () => {
    vi.mocked(storageService.createStorageConnection).mockReturnValue({
      id: 'conn_s3',
      name: 'My S3',
      provider: 's3',
      endpoint: 'http://localhost:9000',
      username: 'minioadmin',
      basePath: '/import',
      region: 'us-east-1',
      bucket: 'bookdock',
      hasSecrets: true,
      createdAt: 3000,
      updatedAt: 3000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My S3',
        provider: 's3',
        endpoint: 'http://localhost:9000',
        username: 'minioadmin',
        password: 'minioadmin',
        region: 'us-east-1',
        bucket: 'bookdock',
        basePath: '/import',
      }),
    })

    expect(res.status).toBe(201)
    expect(storageService.createStorageConnection).toHaveBeenCalledWith('u1', {
      name: 'My S3',
      provider: 's3',
      endpoint: 'http://localhost:9000',
      username: 'minioadmin',
      password: 'minioadmin',
      region: 'us-east-1',
      bucket: 'bookdock',
      basePath: '/import',
    })
  })

  it('POST /:id/import imports books from connection', async () => {
    vi.mocked(storageService.importStorageConnectionBooks).mockResolvedValue({
      results: [
        { path: '/books/sample.epub', name: 'sample.epub', status: 'success', bookId: 'b1' },
      ],
      total: 1,
      successCount: 1,
      duplicateCount: 0,
      errorCount: 0,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-connections/conn_1/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: ['/books/sample.epub'] }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.successCount).toBe(1)
    expect(storageService.importStorageConnectionBooks).toHaveBeenCalledWith('u1', 'conn_1', {
      files: ['/books/sample.epub'],
    })
  })
})
