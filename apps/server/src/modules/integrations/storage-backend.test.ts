import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from '../../middleware/error'
import storageBackendRoutes from './storage-backend.routes'
import * as storageBackendService from './storage-backend.service'

vi.mock('./storage-backend.service', () => ({
  getStorageBackendConfig: vi.fn(),
  testStorageBackend: vi.fn(),
  updateStorageBackend: vi.fn(),
  clearStorageBackendCache: vi.fn(),
  getStorageMigrationStatus: vi.fn(),
  startStorageMigration: vi.fn(),
  pauseStorageMigration: vi.fn(),
  inspectStorageTarget: vi.fn(),
  getStorageRestoreStatus: vi.fn(),
  startStorageRestore: vi.fn(),
  pauseStorageRestore: vi.fn(),
}))

function createApp(user: { id: string; username: string; role: string } | null = { id: 'u1', username: 'tester', role: 'owner' }) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/integrations/storage-backend/*', async (c, next) => {
    c.set('user', user ? { ...user, avatarKey: null } : null)
    return next()
  })
  app.route('/api/v1/integrations/storage-backend', storageBackendRoutes)
  return app
}

describe('Storage backend routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp(null)
    const res = await app.request('/api/v1/integrations/storage-backend')
    expect(res.status).toBe(401)
  })

  it('rejects non-owner requests with 403', async () => {
    const app = createApp({ id: 'u2', username: 'member', role: 'member' })
    const res = await app.request('/api/v1/integrations/storage-backend')
    expect(res.status).toBe(403)
  })

  it('GET / returns storage backend config', async () => {
    vi.mocked(storageBackendService.getStorageBackendConfig).mockResolvedValue({
      enabled: true,
      connectionId: 'conn_1',
      connectionName: 'My WebDAV',
      connectionEndpoint: 'https://dav.test.com',
      basePath: '/Bookdock/storage',
      cacheMaxMb: 2048,
      status: 'active',
      latencyMs: 42,
      totalBookCount: 15,
      totalBookBytes: 60000000,
      totalCoverBytes: 5000000,
      remoteBookCount: 10,
      remoteBytes: 50000000,
      localCachedCount: 8,
      localCachedBytes: 40000000,
      savedDiskBytes: 10000000,
      localTotalBytes: 50000000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.enabled).toBe(true)
    expect(json.data.remoteBookCount).toBe(10)
  })

  it('PUT / updates configuration', async () => {
    vi.mocked(storageBackendService.updateStorageBackend).mockResolvedValue({
      enabled: true,
      connectionId: 'conn_1',
      connectionName: 'My WebDAV',
      connectionEndpoint: 'https://dav.test.com',
      basePath: '/Bookdock/storage',
      cacheMaxMb: 4096,
      status: 'active',
      totalBookCount: 15,
      totalBookBytes: 60000000,
      totalCoverBytes: 5000000,
      remoteBookCount: 0,
      remoteBytes: 0,
      localCachedCount: 0,
      localCachedBytes: 0,
      savedDiskBytes: 0,
      localTotalBytes: 65000000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        connectionId: 'conn_1',
        basePath: '/Bookdock/storage',
        cacheMaxMb: 4096,
      }),
    })

    expect(res.status).toBe(200)
    expect(storageBackendService.updateStorageBackend).toHaveBeenCalledWith({
      enabled: true,
      connectionId: 'conn_1',
      basePath: '/Bookdock/storage',
      cacheMaxMb: 4096,
    })
  })

  it('POST /test tests probe connection and permissions', async () => {
    vi.mocked(storageBackendService.testStorageBackend).mockResolvedValue({
      success: true,
      latencyMs: 35,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'conn_1',
        basePath: '/Bookdock/storage',
      }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.latencyMs).toBe(35)
  })

  it('POST /clear-cache clears local cache', async () => {
    vi.mocked(storageBackendService.clearStorageBackendCache).mockResolvedValue({
      success: true,
      freedBytes: 10485760,
      freedCount: 5,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/clear-cache', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.freedCount).toBe(5)
  })

  it('GET /migration/status returns migration progress', async () => {
    vi.mocked(storageBackendService.getStorageMigrationStatus).mockResolvedValue({
      status: 'running',
      totalBooks: 100,
      migratedBooks: 45,
      freedBytes: 90000000,
      currentBookTitle: '三体',
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/migration/status')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.migratedBooks).toBe(45)
  })

  it('POST /migration/start triggers historical migration', async () => {
    vi.mocked(storageBackendService.startStorageMigration).mockResolvedValue({
      status: 'running',
      totalBooks: 100,
      migratedBooks: 0,
      freedBytes: 0,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/migration/start', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    expect(storageBackendService.startStorageMigration).toHaveBeenCalled()
  })

  it('POST /migration/pause pauses migration queue', async () => {
    vi.mocked(storageBackendService.pauseStorageMigration).mockResolvedValue({
      status: 'idle',
      totalBooks: 100,
      migratedBooks: 45,
      freedBytes: 90000000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/migration/pause', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    expect(storageBackendService.pauseStorageMigration).toHaveBeenCalled()
  })

  it('POST /inspect inspects local storage readiness', async () => {
    vi.mocked(storageBackendService.inspectStorageTarget).mockResolvedValue({
      target: 'local',
      ready: false,
      totalBooks: 20,
      existingBooks: 5,
      missingBooks: 15,
      missingBytes: 150000000,
      reason: 'missing_local_files',
      message: '检测到有 15 本书籍仅保存在远端存储，切回本地前请先还原至本地服务器。',
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'local' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.ready).toBe(false)
    expect(json.data.missingBooks).toBe(15)
  })

  it('GET /restore/status returns restore progress', async () => {
    vi.mocked(storageBackendService.getStorageRestoreStatus).mockResolvedValue({
      status: 'running',
      totalBooks: 15,
      restoredBooks: 3,
      restoredBytes: 30000000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/restore/status')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe('running')
    expect(json.data.restoredBooks).toBe(3)
  })

  it('POST /restore/start triggers restore worker', async () => {
    vi.mocked(storageBackendService.startStorageRestore).mockResolvedValue({
      status: 'running',
      totalBooks: 15,
      restoredBooks: 0,
      restoredBytes: 0,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/restore/start', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    expect(storageBackendService.startStorageRestore).toHaveBeenCalled()
  })

  it('POST /restore/pause pauses restore queue', async () => {
    vi.mocked(storageBackendService.pauseStorageRestore).mockResolvedValue({
      status: 'paused',
      totalBooks: 15,
      restoredBooks: 3,
      restoredBytes: 30000000,
    })

    const app = createApp()
    const res = await app.request('/api/v1/integrations/storage-backend/restore/pause', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    expect(storageBackendService.pauseStorageRestore).toHaveBeenCalled()
  })
})
