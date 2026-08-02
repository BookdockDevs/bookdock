import { Hono } from 'hono'

import { readingRecordCreateSchema, readingRecordHourlySchema, readingRecordRangeSchema } from '@bookdock/shared'

import { addReadingTime, getBookRecords, getByBook, getDaily, getHourly, getSummary } from './reading-records.service'

const readingRecordsRoutes = new Hono()

function serverToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

readingRecordsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = readingRecordCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const record = await addReadingTime(user.id, parsed.data)
  return c.json({ data: record })
})

readingRecordsRoutes.get('/summary', async (c) => {
  const user = c.get('user')
  const todayParam = c.req.query('today')
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : serverToday()
  const summary = await getSummary(user.id, today)
  return c.json({ data: summary })
})

readingRecordsRoutes.get('/daily', async (c) => {
  const user = c.get('user')
  const parsed = readingRecordRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getDaily(user.id, parsed.data)
  return c.json({ data: items })
})

readingRecordsRoutes.get('/by-book', async (c) => {
  const user = c.get('user')
  const parsed = readingRecordRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getByBook(user.id, parsed.data)
  return c.json({ data: items })
})

readingRecordsRoutes.get('/hourly', async (c) => {
  const user = c.get('user')
  const parsed = readingRecordHourlySchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    tzOffset: c.req.query('tzOffset'),
    bookId: c.req.query('bookId'),
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid range', details: parsed.error.flatten() } }, 400)
  }
  const items = await getHourly(user.id, parsed.data, parsed.data.tzOffset)
  return c.json({ data: items })
})

readingRecordsRoutes.get('/book/:bookId', async (c) => {
  const user = c.get('user')
  const detail = await getBookRecords(user.id, c.req.param('bookId'))
  return c.json({ data: detail })
})

export default readingRecordsRoutes
