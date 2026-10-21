import { Hono } from 'hono'

import {
  readingRecordCreateSchema,
  readingRecordHourlySchema,
  readingRecordRangeSchema,
  readingSessionUpdateSchema,
  readingRoundActionSchema,
  readingTimerClaimSchema,
  readingTimerReleaseSchema,
  readingTransferSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { changeReadingRound, claimReadingTimer, deleteReadingArchive, exportReadingTransfer, getReadingLedger, importReadingTransfer, releaseReadingTimer } from './reading-ledger.service'

import {
  addReadingTime,
  deleteSession,
  getBookRecords,
  getByBook,
  getByCategory,
  getByTag,
  getDaily,
  getHourly,
  getSummary,
  updateSession,
} from './reading-records.service'

const readingRecordsRoutes = new Hono()

readingRecordsRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return next()
})

function serverToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

readingRecordsRoutes.get('/book/:bookId/ledger', async (c) => {
  return c.json({ data: await getReadingLedger(c.get('user')!.id, c.req.param('bookId'), c.req.query('showHidden') === '1') })
})

readingRecordsRoutes.delete('/book/:bookId/ledger', (c) => {
  deleteReadingArchive(c.get('user')!.id, c.req.param('bookId'))
  return c.json({ data: { ok: true } })
})

readingRecordsRoutes.post('/book/:bookId/round', async (c) => {
  const parsed = readingRoundActionSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reading round action', parsed.error.flatten())
  return c.json({ data: await changeReadingRound(c.get('user')!.id, c.req.param('bookId'), parsed.data.action, c.req.query('showHidden') === '1') })
})

readingRecordsRoutes.post('/claim', async (c) => {
  const parsed = readingTimerClaimSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reading timer claim', parsed.error.flatten())
  return c.json({ data: claimReadingTimer(c.get('user')!.id, parsed.data) })
})

readingRecordsRoutes.post('/release', async (c) => {
  const parsed = readingTimerReleaseSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reading timer release', parsed.error.flatten())
  releaseReadingTimer(c.get('user')!.id, parsed.data.deviceId, parsed.data.activityAt)
  return c.json({ data: { ok: true } })
})

readingRecordsRoutes.get('/transfer', async (c) => {
  return c.json({ data: await exportReadingTransfer(c.get('user')!.id, c.req.query('bookId')) })
})

for (const operation of ['preview', 'import'] as const) {
  readingRecordsRoutes.post(`/transfer/${operation}`, async (c) => {
    const parsed = readingTransferSchema.safeParse(await c.req.json())
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reading backup', parsed.error.flatten())
    return c.json({ data: importReadingTransfer(c.get('user')!.id, parsed.data, operation === 'preview') })
  })
}

readingRecordsRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json()
  const parsed = readingRecordCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  if (parsed.data.expectedUserId !== undefined && parsed.data.expectedUserId !== user.id) {
    throw new AppError('FORBIDDEN', 'Reading record belongs to a different account')
  }
  const record = await addReadingTime(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: record })
})

readingRecordsRoutes.get('/summary', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const todayParam = c.req.query('today')
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : serverToday()
  const range = readingRecordRangeSchema.safeParse(c.req.query())
  if (!range.success) throw new AppError('VALIDATION_ERROR', 'Invalid summary range')
  const summary = await getSummary(user.id, today, c.req.query('showHidden') === '1', range.data)
  return c.json({ data: summary })
})

readingRecordsRoutes.get('/daily', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getDaily(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/by-book', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getByBook(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/by-category', async (c) => {
  const parsed = readingRecordRangeSchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid range', parsed.error.flatten())
  return c.json({ data: await getByCategory(c.get('user')!.id, parsed.data, c.req.query('showHidden') === '1') })
})

readingRecordsRoutes.get('/by-tag', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getByTag(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/hourly', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordHourlySchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    timezone: c.req.query('timezone'),
    tzOffset: c.req.query('tzOffset'),
    bookId: c.req.query('bookId'),
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getHourly(user.id, parsed.data, parsed.data.tzOffset, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/book/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reading range')
  const detail = await getBookRecords(user.id, c.req.param('bookId'), c.req.query('showHidden') === '1', parsed.data)
  return c.json({ data: detail })
})

readingRecordsRoutes.put('/sessions/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json()
  const parsed = readingSessionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const session = await updateSession(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: session })
})

readingRecordsRoutes.delete('/sessions/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  await deleteSession(user.id, c.req.param('id'))
  return c.json({ data: { ok: true } })
})

export default readingRecordsRoutes
