import { Hono } from 'hono'

import {
  readingDetailListSchema,
  readingRecordCreateSchema,
  readingRecordHourlySchema,
  readingRecordRangeSchema,
  readingSessionListSchema,
  readingSessionUpdateSchema,
} from '@bookdock/shared'

import {
  addReadingTime,
  deleteSession,
  getBookDetail,
  getBookRecords,
  getByBook,
  getByTag,
  getDaily,
  getHourly,
  getSummary,
  listSessions,
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

readingRecordsRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json()
  const parsed = readingRecordCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const record = await addReadingTime(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: record })
})

readingRecordsRoutes.get('/summary', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const todayParam = c.req.query('today')
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : serverToday()
  const summary = await getSummary(user.id, today, c.req.query('showHidden') === '1')
  return c.json({ data: summary })
})

readingRecordsRoutes.get('/daily', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getDaily(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/by-book', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getByBook(user.id, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

readingRecordsRoutes.get('/by-tag', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRecordRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
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
  const detail = await getBookRecords(user.id, c.req.param('bookId'), c.req.query('showHidden') === '1')
  return c.json({ data: detail })
})

// Mixed detail feed: manual sessions + auto-mode day rows, newest first
readingRecordsRoutes.get('/book/:bookId/detail', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingDetailListSchema.safeParse({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } }, 400)
  }
  const items = await getBookDetail(user.id, c.req.param('bookId'), parsed.data.limit, parsed.data.offset, c.req.query('showHidden') === '1')
  return c.json({ data: items })
})

// Manual-session maintenance: the per-book session list feeds the reader stats
// sidebar's session records (manual sessions only on the client; the endpoints
// guard auto-mode rows server-side) and supports edit/delete with daily
// aggregate adjustment.
readingRecordsRoutes.get('/sessions', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingSessionListSchema.safeParse({
    bookId: c.req.query('bookId'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } }, 400)
  }
  const sessions = await listSessions(user.id, parsed.data.bookId, parsed.data.limit, parsed.data.offset, c.req.query('showHidden') === '1')
  return c.json({ data: sessions })
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
