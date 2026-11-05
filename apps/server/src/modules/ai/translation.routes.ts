import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { stream } from 'hono/streaming'

import { translationPreferencesSchema, translationRequestSchema, type TranslationEvent } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { log } from '../../lib/logger'
import { AppError } from '../../middleware/error'
import { translateAiSelection } from './ai.service'

const translationRoutes = new Hono()

translationRoutes.use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new AppError('VALIDATION_ERROR', 'Translation request is too large') } }))

translationRoutes.use('*', async (c, next) => {
  if (!c.get('user') || c.get('guest')) throw new AppError('UNAUTHORIZED', 'Login required')
  await next()
})

translationRoutes.get('/config', (c) => {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, c.get('user')!.id), eq(settings.key, 'translation'))).get()
  const parsed = translationPreferencesSchema.safeParse(row?.value)
  return c.json({ data: parsed.success ? parsed.data : translationPreferencesSchema.parse({}) })
})

translationRoutes.put('/config', async (c) => {
  const parsed = translationPreferencesSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid translation preferences')
  const db = getDb()
  const userId = c.get('user')!.id
  db.insert(settings).values({ id: createId('setting'), userId, key: 'translation', value: parsed.data })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value: parsed.data } }).run()
  return c.json({ data: parsed.data })
})

translationRoutes.post('/translate', async (c) => {
  const parsed = translationRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid translation request')
  const user = c.get('user')!
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  c.header('X-Accel-Buffering', 'no')
  return stream(c, async (output) => {
    const controller = new AbortController()
    output.onAbort(() => controller.abort())
    const signal = AbortSignal.any([controller.signal, c.req.raw.signal])
    let pending = Promise.resolve()
    const send = (event: TranslationEvent) => {
      pending = pending.then(async () => { if (!signal.aborted) await output.write(`${JSON.stringify(event)}\n`) })
      // Writing can fail before the provider finishes. Observe it immediately.
      void pending.catch(() => controller.abort())
    }
    try {
      await translateAiSelection(user.id, user.role, parsed.data, signal, (text) => send({ type: 'delta', text }))
      send({ type: 'done' })
    } catch (error) {
      if (!signal.aborted) {
        const code = error instanceof AppError ? error.code : 'AI_PROVIDER_ERROR'
        log('warn', 'translation.failed', { requestId: c.get('requestId'), meta: { code } })
        send({ type: 'error', code, message: error instanceof AppError ? error.message : 'Translation failed' })
      }
    } finally {
      await pending.catch(() => {})
    }
  })
})

export default translationRoutes
