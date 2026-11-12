import { Hono } from 'hono'

import { aiChatJobCreateSchema, aiChatJobListSchema, aiChatSchema, aiConfigTestSchema, aiConfigUpdateSchema, aiGenerationRunIdSchema, aiLocalChatSchema, aiMessageIdSchema, aiModelDiscoverySchema, aiProfileCreateSchema, aiProfileUpdateSchema, aiSearchSchema, aiThreadCreateSchema, aiThreadListSchema, aiThreadUpdateSchema, type AiConfigRes, type AiConnectionTestRes, type AiGenerationRunRes, type AiMessageRevisionRes, type AiModelRes, type AiProfileRes, type AiProviderRes, type AiSearchRes, type AiStatusRes, type AiThreadDetailRes, type AiThreadRes } from '@bookdock/shared'

import { cancelAiChatRun, createAiChatStream, createAiLocalChatStream, createAiProfile, deleteAiProfile, getAiConfig, getAiSearchChapterLimit, getAiStatus, listAiModels, listAiProviders, testAiConfig, testAiConfigDraft, updateAiConfig, updateAiProfile } from './ai.service'
import { createAiThread, deleteAiThread, getAiThread, listAiMessageRevisions, listAiThreads, selectAiMessageRevision, updateAiThread } from './ai.sessions.service'
import { searchAiBook } from './ai.retrieval.service'
import { getAiGenerationRun } from './ai.runs.service'

import { acknowledgeAiChatJob, cancelAiChatJob, cancelAiThreadJobs, createAiChatJob, getAiChatJob, listAiChatJobs } from './ai.jobs.service'

const aiRoutes = new Hono()

aiRoutes.get('/providers', (c) => {
  return c.json({ data: listAiProviders() } satisfies { data: readonly AiProviderRes[] })
})

aiRoutes.get('/status', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: getAiStatus(user.id, user.role) } satisfies { data: AiStatusRes })
})

aiRoutes.get('/config', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: getAiConfig(user.id) } satisfies { data: AiConfigRes })
})

aiRoutes.patch('/config', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const raw = await c.req.json().catch(() => null)
  const parsed = aiConfigUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI configuration', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiConfig(user.id, parsed.data) } satisfies { data: AiConfigRes })
})

aiRoutes.post('/profiles', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiProfileCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI profile', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: createAiProfile(user.id, user.role, parsed.data) } satisfies { data: AiProfileRes }, 201)
})

aiRoutes.patch('/profiles/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiProfileUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI profile', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiProfile(user.id, user.role, c.req.param('id'), parsed.data) } satisfies { data: AiProfileRes })
})

aiRoutes.delete('/profiles/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  deleteAiProfile(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

aiRoutes.post('/models', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const raw = await c.req.json().catch(() => null)
  const parsed = aiModelDiscoverySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI model discovery request', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: await listAiModels(user.id, user.role, parsed.data, c.req.raw.signal) } satisfies { data: AiModelRes[] })
})

aiRoutes.post('/test', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const raw = await c.req.json().catch(() => null)
  const parsed = aiConfigTestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI test request', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: await testAiConfigDraft(user.id, user.role, parsed.data, c.req.raw.signal) } satisfies { data: AiConnectionTestRes })
})

aiRoutes.post('/config/test', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await testAiConfig(user.id, user.role, c.req.raw.signal) } satisfies { data: AiConnectionTestRes })
})

aiRoutes.get('/threads', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiThreadListSchema.safeParse({ bookId: c.req.query('bookId'), limit: c.req.query('limit') })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI thread list request', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: listAiThreads(user.id, parsed.data) } satisfies { data: AiThreadRes[] })
})

aiRoutes.post('/threads', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiThreadCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI thread', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: createAiThread(user.id, parsed.data) } satisfies { data: AiThreadRes }, 201)
})

aiRoutes.get('/threads/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: getAiThread(user.id, c.req.param('id')) } satisfies { data: AiThreadDetailRes })
})

aiRoutes.get('/threads/:id/messages/:messageId/revisions', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiMessageIdSchema.safeParse(c.req.param('messageId'))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI message id' } }, 400)
  }
  return c.json({ data: listAiMessageRevisions(user.id, c.req.param('id'), parsed.data) } satisfies { data: AiMessageRevisionRes[] })
})

aiRoutes.post('/threads/:id/messages/:messageId/revisions/select', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiMessageIdSchema.safeParse(c.req.param('messageId'))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI message id' } }, 400)
  }
  return c.json({ data: selectAiMessageRevision(user.id, c.req.param('id'), parsed.data) } satisfies { data: AiMessageRevisionRes })
})

aiRoutes.patch('/threads/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiThreadUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI thread', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiThread(user.id, c.req.param('id'), parsed.data) } satisfies { data: AiThreadRes })
})

aiRoutes.delete('/threads/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  getAiThread(user.id, c.req.param('id'))
  cancelAiThreadJobs(user.id, c.req.param('id'))
  deleteAiThread(user.id, c.req.param('id'))
  return c.json({ data: null })
})

aiRoutes.get('/runs/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiGenerationRunIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI generation run id' } }, 400)
  }
  return c.json({ data: getAiGenerationRun(user.id, parsed.data) } satisfies { data: AiGenerationRunRes })
})

aiRoutes.post('/runs/:id/cancel', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiGenerationRunIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI generation run id' } }, 400)
  }
  return c.json({ data: cancelAiChatRun(user.id, parsed.data) } satisfies { data: AiGenerationRunRes })
})

aiRoutes.post('/retrieval/search', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiSearchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI search request', details: parsed.error.flatten() } }, 400)
  }
  const serverMaxChapterIndex = await getAiSearchChapterLimit(user.id, parsed.data.bookId)
  const maxChapterIndex = parsed.data.maxChapterIndex === undefined || parsed.data.maxChapterIndex < 0
    ? serverMaxChapterIndex
    : Math.min(parsed.data.maxChapterIndex, serverMaxChapterIndex)
  return c.json({ data: await searchAiBook(user.id, { ...parsed.data, maxChapterIndex }, {
    signal: c.req.raw.signal,
  }) } satisfies { data: AiSearchRes })
})

aiRoutes.post('/jobs', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiChatJobCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI job', details: parsed.error.flatten() } }, 400)
  return c.json({ data: await createAiChatJob(user.id, user.role, parsed.data) }, 202)
})

aiRoutes.get('/jobs', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiChatJobListSchema.safeParse(c.req.query())
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI job scope' } }, 400)
  return c.json({ data: await listAiChatJobs(user.id, parsed.data.kind, parsed.data.scopeKey) })
})

aiRoutes.get('/jobs/:id', (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: getAiChatJob(user.id, c.req.param('id')) })
})

aiRoutes.post('/jobs/:id/cancel', (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: cancelAiChatJob(user.id, c.req.param('id')) })
})

aiRoutes.post('/jobs/:id/acknowledge', (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  acknowledgeAiChatJob(user.id, c.req.param('id'))
  return c.json({ data: null })
})

aiRoutes.post('/chat', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const raw = await c.req.json().catch(() => null)
  const normalizedRaw = raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).threadId === 'string'
    ? { ...(raw as Record<string, unknown>), history: undefined }
    : raw
  const parsed = aiChatSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI chat request', details: parsed.error.flatten() } }, 400)
  }
  const result = await createAiChatStream(user.id, user.role, parsed.data, c.req.raw.signal)
  return c.newResponse(result.stream, 200, {
    'Cache-Control': 'no-cache, no-transform',
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-AI-Request-ID': result.requestId,
    'X-AI-Run-ID': result.runId,
  })
})

aiRoutes.post('/local-chat', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiLocalChatSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid local AI chat request', details: parsed.error.flatten() } }, 400)
  }
  const result = await createAiLocalChatStream(user.id, user.role, parsed.data, c.req.raw.signal)
  return c.newResponse(result.stream, 200, {
    'Cache-Control': 'no-cache, no-transform',
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-AI-Request-ID': result.requestId,
  })
})

export default aiRoutes
