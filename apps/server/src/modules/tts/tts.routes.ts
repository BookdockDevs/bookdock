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
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: listTtsServices(user.id) } satisfies { data: TtsServiceRes[] })
})

ttsRoutes.post('/services', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = ttsServiceCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: createTtsService(user.id, parsed.data) } satisfies { data: TtsServiceRes }, 201)
})

ttsRoutes.get('/services/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const service = listTtsServices(user.id).find((item) => item.id === c.req.param('id'))
  if (!service) return c.json({ error: { code: 'TTS_SERVICE_NOT_FOUND', message: 'TTS service not found' } }, 404)
  return c.json({ data: service } satisfies { data: TtsServiceRes })
})

ttsRoutes.put('/services/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = ttsServiceUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: updateTtsService(user.id, c.req.param('id'), parsed.data) } satisfies { data: TtsServiceRes })
})

ttsRoutes.delete('/services/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  deleteTtsService(user.id, c.req.param('id'))
  return c.json({ data: null })
})

ttsRoutes.post('/services/test', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = ttsServiceCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid TTS service', details: parsed.error.flatten() } }, 400)
  return c.json({ data: await testTtsServiceDraft(parsed.data, c.req.raw.signal) })
})

ttsRoutes.get('/services/:id/voices', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const voices = await listTtsVoices(user.id, c.req.param('id'), c.req.raw.signal)
  return c.json({ data: voices })
})

ttsRoutes.post('/services/:id/test', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await testTtsService(user.id, c.req.param('id'), c.req.raw.signal) })
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
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = ttsSpeechSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid speech request', details: parsed.error.flatten() } }, 400)
  const result = await synthesizeSpeech(user.id, parsed.data, c.req.raw.signal)
  return c.newResponse(new Uint8Array(result.audio), 200, {
    'Content-Type': result.contentType,
    'Content-Length': String(result.audio.length),
    'Cache-Control': 'no-store',
  })
})

export default ttsRoutes
