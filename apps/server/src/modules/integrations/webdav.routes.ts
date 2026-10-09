import { Hono } from 'hono'
import {
  webdavConfigUpdateSchema,
  webdavImportReqSchema,
  webdavLsReqSchema,
  webdavTestReqSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import {
  deleteWebDavConfig,
  getWebDavConfig,
  importWebDavBooks,
  listWebDavFiles,
  testWebDavConnection,
  updateWebDavConfig,
} from './webdav.service'

const webdavRoutes = new Hono()

webdavRoutes.get('/config', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const data = getWebDavConfig(user.id)
  return c.json({ data }, 200)
})

webdavRoutes.put('/config', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavConfigUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid WebDAV configuration', parsed.error.flatten())
  }

  const data = updateWebDavConfig(user.id, parsed.data)
  return c.json({ data }, 200)
})

webdavRoutes.delete('/config', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  deleteWebDavConfig(user.id)
  return c.json({ data: { success: true } }, 200)
})

webdavRoutes.post('/test', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavTestReqSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid test request payload', parsed.error.flatten())
  }

  const result = await testWebDavConnection(user.id, parsed.data)
  return c.json({ data: result }, 200)
})

webdavRoutes.post('/ls', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavLsReqSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid directory listing request', parsed.error.flatten())
  }

  const entries = await listWebDavFiles(user.id, parsed.data.path)
  return c.json({ data: entries }, 200)
})

webdavRoutes.post('/import', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')

  const body = await c.req.json().catch(() => ({}))
  const parsed = webdavImportReqSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid import request payload', parsed.error.flatten())
  }

  const result = await importWebDavBooks(user.id, parsed.data)
  return c.json({ data: result }, 200)
})

export default webdavRoutes
