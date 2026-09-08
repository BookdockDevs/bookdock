import { Hono } from 'hono'

import {
  ttsEdgeSpeechSchema,
  ttsServiceCreateSchema,
  ttsServiceUpdateSchema,
  ttsSpeechSchema,
  type TtsProviderRes,
  type TtsServiceRes,
} from '@bookdock/shared'

import { synthesizeEdgeSpeech } from './edge-tts'
import {
  createTtsService,
  deleteTtsService,
  listTtsProviders,
  listTtsServices,
  listTtsVoices,
  synthesizeSpeech,
  testTtsServiceDraft,
  testTtsService,
  updateTtsService,
} from './tts.service'

const ttsRoutes = new Hono()

ttsRoutes.get('/providers', (c) => c.json({ data: listTtsProviders() } satisfies { data: readonly TtsProviderRes[] }))

ttsRoutes.get('/services', (c) => {
  const user = c.get('user')
  return c.json({ data: listTtsServices(user.id, user.role) } satisfies { data: TtsServiceRes[] })
})

ttsRoutes.post('/services', async (c) => {
  const user = c.get('user')
  const parsed = ttsServiceCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: createTtsService(user.id, user.role, parsed.data) } satisfies { data: TtsServiceRes }, 201)
})

ttsRoutes.get('/services/:id', (c) => {
  const user = c.get('user')
  const service = listTtsServices(user.id, user.role).find((item) => item.id === c.req.param('id'))
  if (!service) return c.json({ error: { code: 'TTS_SERVICE_NOT_FOUND', message: 'TTS service not found' } }, 404)
  return c.json({ data: service } satisfies { data: TtsServiceRes })
})

ttsRoutes.put('/services/:id', async (c) => {
  const user = c.get('user')
  const parsed = ttsServiceUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: updateTtsService(user.id, user.role, c.req.param('id'), parsed.data) } satisfies { data: TtsServiceRes })
})

ttsRoutes.delete('/services/:id', (c) => {
  const user = c.get('user')
  deleteTtsService(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

ttsRoutes.post('/services/test', async (c) => {
  const user = c.get('user')
  const parsed = ttsServiceCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: await testTtsServiceDraft(user.role, parsed.data, c.req.raw.signal) })
})

ttsRoutes.get('/services/:id/voices', async (c) => {
  const user = c.get('user')
  const voices = await listTtsVoices(user.id, user.role, c.req.param('id'), c.req.raw.signal)
  return c.json({ data: voices })
})

ttsRoutes.post('/services/:id/test', async (c) => {
  const user = c.get('user')
  return c.json({ data: await testTtsService(user.id, user.role, c.req.param('id'), c.req.raw.signal) })
})

ttsRoutes.post('/edge/speech', async (c) => {
  const parsed = ttsEdgeSpeechSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Edge speech request', details: parsed.error.flatten() } }, 400)
  const result = await synthesizeEdgeSpeech(parsed.data, c.req.raw.signal)
  return c.newResponse(new Uint8Array(result.audio), 200, {
    'Content-Type': result.contentType,
    'Content-Length': String(result.audio.length),
    'Cache-Control': 'no-store',
  })
})

ttsRoutes.post('/speech', async (c) => {
  const user = c.get('user')
  const parsed = ttsSpeechSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid speech request', details: parsed.error.flatten() } }, 400)
  const result = await synthesizeSpeech(user.id, user.role, parsed.data, c.req.raw.signal)
  return c.newResponse(new Uint8Array(result.audio), 200, {
    'Content-Type': result.contentType,
    'Content-Length': String(result.audio.length),
    'Cache-Control': 'no-store',
  })
})

export default ttsRoutes
