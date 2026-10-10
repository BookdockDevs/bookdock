import { Hono } from 'hono'

import {
  inspectStorageTargetSchema,
  testStorageBackendSchema,
  updateStorageBackendSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import {
  clearStorageBackendCache,
  getStorageBackendConfig,
  getStorageMigrationStatus,
  getStorageRestoreStatus,
  inspectStorageTarget,
  pauseStorageMigration,
  pauseStorageRestore,
  startStorageMigration,
  startStorageRestore,
  testStorageBackend,
  updateStorageBackend,
} from './storage-backend.service'

const storageBackendRoutes = new Hono()

// Require owner for all storage backend operations
storageBackendRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  if (user.role !== 'owner') throw new AppError('FORBIDDEN', 'Owner access required')
  await next()
})

storageBackendRoutes.get('/', async (c) => {
  const data = await getStorageBackendConfig()
  return c.json({ data }, 200)
})

storageBackendRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateStorageBackendSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid storage backend configuration', parsed.error.flatten())
  }

  const data = await updateStorageBackend(parsed.data)
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = testStorageBackendSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid test request payload', parsed.error.flatten())
  }

  const data = await testStorageBackend(parsed.data)
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/clear-cache', async (c) => {
  const data = await clearStorageBackendCache()
  return c.json({ data }, 200)
})

storageBackendRoutes.get('/migration/status', async (c) => {
  const data = await getStorageMigrationStatus()
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/migration/start', async (c) => {
  const data = await startStorageMigration()
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/migration/pause', async (c) => {
  const data = await pauseStorageMigration()
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/inspect', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = inspectStorageTargetSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid inspect request payload', parsed.error.flatten())
  }

  const data = await inspectStorageTarget(parsed.data)
  return c.json({ data }, 200)
})

storageBackendRoutes.get('/restore/status', async (c) => {
  const data = await getStorageRestoreStatus()
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/restore/start', async (c) => {
  const data = await startStorageRestore()
  return c.json({ data }, 200)
})

storageBackendRoutes.post('/restore/pause', async (c) => {
  const data = await pauseStorageRestore()
  return c.json({ data }, 200)
})

export default storageBackendRoutes
