import { Hono } from 'hono'
import {
  createStorageConnectionSchema,
  testDirectStorageConnectionSchema,
  testStorageConnectionSchema,
  updateStorageConnectionSchema,
  webdavImportReqSchema,
  webdavLsReqSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import {
  createStorageConnection,
  deleteStorageConnection,
  getStorageConnection,
  importStorageConnectionBooks,
  listStorageConnectionFiles,
  listStorageConnections,
  testDirectStorageConnection,
  testStorageConnection,
  updateStorageConnection,
} from './storage-connection.service'

const storageConnectionRoutes = new Hono()

storageConnectionRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const data = listStorageConnections(user.id)
  return c.json({ data }, 200)
})

storageConnectionRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = createStorageConnectionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid storage connection configuration', parsed.error.flatten())
  }

  const data = createStorageConnection(user.id, parsed.data)
  return c.json({ data }, 201)
})

storageConnectionRoutes.post('/test', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = testDirectStorageConnectionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid test request payload', parsed.error.flatten())
  }

  const result = await testDirectStorageConnection(parsed.data)
  return c.json({ data: result }, 200)
})

storageConnectionRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  const data = getStorageConnection(user.id, id)
  return c.json({ data }, 200)
})

storageConnectionRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = updateStorageConnectionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid update request payload', parsed.error.flatten())
  }

  const data = updateStorageConnection(user.id, id, parsed.data)
  return c.json({ data }, 200)
})

storageConnectionRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  deleteStorageConnection(user.id, id)
  return c.json({ data: { success: true } }, 200)
})

storageConnectionRoutes.post('/:id/test', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = testStorageConnectionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid test request payload', parsed.error.flatten())
  }

  const result = await testStorageConnection(user.id, id, parsed.data)
  return c.json({ data: result }, 200)
})

storageConnectionRoutes.post('/:id/ls', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavLsReqSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid directory listing request', parsed.error.flatten())
  }

  const entries = await listStorageConnectionFiles(user.id, id, parsed.data.path)
  return c.json({ data: entries }, 200)
})

storageConnectionRoutes.post('/:id/import', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavImportReqSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid import request payload', parsed.error.flatten())
  }

  const result = await importStorageConnectionBooks(user.id, id, parsed.data)
  return c.json({ data: result }, 200)
})

export default storageConnectionRoutes
