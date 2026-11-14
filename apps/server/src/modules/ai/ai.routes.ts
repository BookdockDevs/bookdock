import { Hono } from 'hono'

import { aiChatJobCreateSchema, aiChatJobListSchema, aiChatSchema, aiConfigUpdateSchema, aiConnectionCreateSchema, aiConnectionUpdateSchema, aiGenerationRunIdSchema, aiLocalChatSchema, aiMessageIdSchema, aiModelDiscoverSchema, aiModelEntryCreateSchema, aiModelEntryUpdateSchema, aiPromptCreateSchema, aiPromptReorderSchema, aiPromptUpdateSchema, aiSearchSchema, aiThreadCreateSchema, aiThreadListSchema, aiThreadUpdateSchema, type AiConfigRes, type AiConnectionModelTestRes, type AiConnectionRes, type AiGenerationRunRes, type AiMessageRevisionRes, type AiModelEntryRes, type AiPromptTemplate, type AiProviderRes, type AiSearchRes, type AiStatusRes, type AiThreadDetailRes, type AiThreadRes } from '@bookdock/shared'

import { cancelAiChatRun, createAiChatStream, createAiLocalChatStream, discoverAiConnectionModels, getAiConfig, getAiSearchChapterLimit, getAiStatus, listAiProviders, testAiModel, updateAiConfig } from './ai.service'
import { createAiConnection, createAiModel, deleteAiConnection, deleteAiModel, mergeDiscoveredModels, updateAiConnection, updateAiModel } from './ai.connections.service'
import { createAiPrompt, deleteAiPrompt, reorderAiPrompts, restoreAiPrompts, updateAiPrompt } from './ai.prompts.service'
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
  return c.json({ data: getAiStatus(user.id) } satisfies { data: AiStatusRes })
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

aiRoutes.post('/connections', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiConnectionCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI connection', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: createAiConnection(user.id, user.role, parsed.data) } satisfies { data: AiConnectionRes }, 201)
})

aiRoutes.patch('/connections/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiConnectionUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI connection', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiConnection(user.id, user.role, c.req.param('id'), parsed.data) } satisfies { data: AiConnectionRes })
})

aiRoutes.delete('/connections/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  deleteAiConnection(user.id, c.req.param('id'))
  return c.json({ data: null })
})

// Static segments are registered before `:id` routes so they never resolve as an id.
aiRoutes.post('/connections/:id/models', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiModelEntryCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI model', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: createAiModel(user.id, c.req.param('id'), parsed.data) } satisfies { data: AiModelEntryRes }, 201)
})

aiRoutes.post('/connections/:id/models/discover', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiModelDiscoverSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI model discovery request' } }, 400)
  }
  const discovered = await discoverAiConnectionModels(user.id, user.role, c.req.param('id'), parsed.data.kind, c.req.raw.signal)
  return c.json({ data: mergeDiscoveredModels(user.id, c.req.param('id'), discovered) } satisfies { data: AiModelEntryRes[] })
})

aiRoutes.patch('/models/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiModelEntryUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid AI model', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiModel(user.id, c.req.param('id'), parsed.data) } satisfies { data: AiModelEntryRes })
})

aiRoutes.delete('/models/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  deleteAiModel(user.id, c.req.param('id'))
  return c.json({ data: null })
})

aiRoutes.post('/models/:id/test', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await testAiModel(user.id, user.role, c.req.param('id'), c.req.raw.signal) } satisfies { data: AiConnectionModelTestRes })
})

// Static segments are registered before `:id` routes so they never resolve as an id.
aiRoutes.post('/prompts', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiPromptCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid quick command', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: createAiPrompt(user.id, user.role, parsed.data) } satisfies { data: AiPromptTemplate }, 201)
})

aiRoutes.put('/prompts/reorder', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiPromptReorderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid quick command order', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: reorderAiPrompts(user.id, parsed.data) } satisfies { data: AiPromptTemplate[] })
})

aiRoutes.post('/prompts/restore', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: restoreAiPrompts(user.id) } satisfies { data: AiPromptTemplate[] })
})

aiRoutes.patch('/prompts/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = aiPromptUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid quick command', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAiPrompt(user.id, user.role, c.req.param('id'), parsed.data) } satisfies { data: AiPromptTemplate })
})

aiRoutes.delete('/prompts/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  deleteAiPrompt(user.id, c.req.param('id'))
  return c.json({ data: null })
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
