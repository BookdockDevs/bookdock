import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm'

import { AI_MAX_CONTEXT_CHARS } from '@bookdock/shared'
import type { AiChatJobCreateReq, AiChatJobRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiChatJobs } from '../../db/schema'
import { createId } from '../../lib/id'
import { log } from '../../lib/logger'
import { AppError, isUniqueViolation } from '../../middleware/error'
import { getActiveBook } from '../books/books.service'
import { createAiThread, getAiThread } from './ai.sessions.service'
import { cancelAiChatRun, createAiChatStream, createAiLocalChatStream } from './ai.service'

const workers = new Map<string, AbortController>()
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function ownedJob(userId: string, id: string, checkReadAccess = true) {
  const row = getDb().select().from(aiChatJobs).where(and(eq(aiChatJobs.id, id), eq(aiChatJobs.userId, userId))).get()
  if (!row || (row.state !== 'running' && row.updatedAt < Date.now() - RETENTION_MS)) throw new AppError('NOT_FOUND', 'AI job not found')
  if (checkReadAccess && row.kind === 'book' && row.threadId) getAiThread(userId, row.threadId)
  return row
}

export function getAiChatJob(userId: string, id: string): AiChatJobRes {
  return ownedJob(userId, id).snapshot
}

export async function listAiChatJobs(userId: string, kind: 'book' | 'local', scopeKey: string): Promise<AiChatJobRes[]> {
  if (kind === 'book') await getActiveBook(userId, scopeKey)
  return getDb().select().from(aiChatJobs).where(and(
    eq(aiChatJobs.userId, userId), eq(aiChatJobs.kind, kind), eq(aiChatJobs.scopeKey, scopeKey), isNull(aiChatJobs.acknowledgedAt), gte(aiChatJobs.updatedAt, Date.now() - RETENTION_MS),
  )).orderBy(desc(aiChatJobs.createdAt)).limit(50).all().map((row) => row.snapshot)
}

export function acknowledgeAiChatJob(userId: string, id: string) {
  const row = ownedJob(userId, id, false)
  if (row.state === 'running') throw new AppError('AI_RUN_CONFLICT', 'AI job is still running')
  getDb().update(aiChatJobs).set({ acknowledgedAt: Date.now() }).where(and(eq(aiChatJobs.id, id), eq(aiChatJobs.userId, userId))).run()
}

export function cancelAiChatJob(userId: string, id: string): AiChatJobRes {
  const row = ownedJob(userId, id, false)
  if (row.state !== 'running') return row.snapshot
  if (row.snapshot.runId) cancelAiChatRun(userId, row.snapshot.runId)
  workers.get(id)?.abort()
  const snapshot: AiChatJobRes = { ...row.snapshot, state: 'cancelled', updatedAt: Date.now() }
  getDb().update(aiChatJobs).set({ state: 'cancelled', snapshot, updatedAt: snapshot.updatedAt }).where(and(eq(aiChatJobs.id, id), eq(aiChatJobs.userId, userId))).run()
  return snapshot
}

export function cancelAiThreadJobs(userId: string, threadId: string) {
  const rows = getDb().select({ id: aiChatJobs.id }).from(aiChatJobs).where(and(
    eq(aiChatJobs.userId, userId), eq(aiChatJobs.threadId, threadId), eq(aiChatJobs.kind, 'book'), eq(aiChatJobs.state, 'running'),
  )).all()
  for (const row of rows) cancelAiChatJob(userId, row.id)
}

export function interruptStaleAiChatJobs() {
  const rows = getDb().select().from(aiChatJobs).where(eq(aiChatJobs.state, 'running')).all()
  for (const row of rows) {
    const snapshot: AiChatJobRes = {
      ...row.snapshot, state: 'interrupted', updatedAt: Date.now(),
      error: { code: 'AI_PROVIDER_ERROR', message: 'The server restarted before this AI job completed. Retry manually.' },
    }
    getDb().update(aiChatJobs).set({ state: snapshot.state, snapshot, updatedAt: snapshot.updatedAt }).where(eq(aiChatJobs.id, row.id)).run()
  }
  return rows.length
}

export async function createAiChatJob(userId: string, role: string, input: AiChatJobCreateReq): Promise<AiChatJobRes> {
  if (role !== 'owner' && role !== 'member') throw new AppError('AI_NOT_ALLOWED', 'Login required')
  const db = getDb()
  const duplicate = db.select().from(aiChatJobs).where(and(eq(aiChatJobs.userId, userId), eq(aiChatJobs.clientRequestId, input.clientRequestId))).get()
  if (duplicate) return getAiChatJob(userId, duplicate.id)
  if (db.select({ id: aiChatJobs.id }).from(aiChatJobs).where(and(eq(aiChatJobs.userId, userId), eq(aiChatJobs.state, 'running'))).get()) {
    throw new AppError('AI_BUSY', 'Another AI request is already running')
  }
  if (input.kind === 'book') {
    await getActiveBook(userId, input.request.bookId)
    if (input.request.threadId) getAiThread(userId, input.request.threadId)
    else {
      const thread = createAiThread(userId, { bookId: input.request.bookId, title: input.request.prompt.slice(0, 100) })
      input = { ...input, request: { ...input.request, threadId: thread.id } }
    }
  }
  const now = Date.now()
  db.delete(aiChatJobs).where(and(eq(aiChatJobs.userId, userId), lt(aiChatJobs.updatedAt, now - RETENTION_MS))).run()
  const snapshot: AiChatJobRes = {
    id: createId('ai-job'), kind: input.kind,
    scopeKey: input.kind === 'book' ? input.request.bookId : input.scopeKey,
    clientRequestId: input.clientRequestId,
    threadId: input.kind === 'book' ? input.request.threadId! : input.threadId,
    runId: null, state: 'running', content: '', citations: [], receipt: null, tool: null, error: null, createdAt: now, updatedAt: now,
  }
  try {
    db.insert(aiChatJobs).values({
      id: snapshot.id, userId, kind: snapshot.kind, scopeKey: snapshot.scopeKey,
      clientRequestId: snapshot.clientRequestId, threadId: snapshot.threadId,
      state: snapshot.state, snapshot, createdAt: now, updatedAt: now,
    }).run()
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('AI_BUSY', 'Another AI request is already running')
    throw error
  }
  const controller = new AbortController()
  workers.set(snapshot.id, controller)
  // The accepted task owns this signal; an observer disconnect never reaches it.
  void executeJob(userId, role, input, snapshot, controller).catch((error) => {
    log('error', 'ai.job.persistence_failed', { error, meta: { jobId: snapshot.id } })
  })
  return snapshot
}

async function executeJob(userId: string, role: string, input: AiChatJobCreateReq, initial: AiChatJobRes, controller: AbortController) {
  let snapshot = { ...initial }
  let lastCheckpointAt = 0
  const persist = (force = false) => {
    if (!force && Date.now() - lastCheckpointAt < 250) return
    lastCheckpointAt = Date.now()
    snapshot = { ...snapshot, updatedAt: Date.now() }
    getDb().update(aiChatJobs).set({ snapshot, state: snapshot.state, updatedAt: snapshot.updatedAt }).where(and(
      eq(aiChatJobs.id, snapshot.id), eq(aiChatJobs.userId, userId), eq(aiChatJobs.state, 'running'),
    )).run()
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const result = input.kind === 'book'
      ? await createAiChatStream(userId, role, input.request, controller.signal)
      : await createAiLocalChatStream(userId, role, input.request, controller.signal)
    if ('runId' in result && typeof result.runId === 'string') snapshot.runId = result.runId
    reader = result.stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const consume = (block: string) => {
      const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (!data) return
      const value = JSON.parse(data)
      if (event === 'meta') snapshot = { ...snapshot, receipt: value.receipt ?? snapshot.receipt, runId: value.runId ?? snapshot.runId }
      if (event === 'delta') snapshot = { ...snapshot, content: (snapshot.content + value.text).slice(0, AI_MAX_CONTEXT_CHARS) }
      if (event === 'tool') snapshot = { ...snapshot, tool: value }
      if (event === 'done') snapshot = { ...snapshot, state: 'completed', content: value.content.slice(0, AI_MAX_CONTEXT_CHARS), citations: value.citations ?? [], tool: null }
      if (event === 'error') snapshot = { ...snapshot, state: 'failed', error: { code: value.code, message: value.message }, tool: null }
      persist(event === 'done' || event === 'error' || event === 'meta')
    }
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, separator))
        buffer = buffer.slice(separator + 2)
      }
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
    if (snapshot.state === 'running') {
      snapshot = { ...snapshot, state: controller.signal.aborted ? 'cancelled' : 'interrupted' }
    }
  } catch (error) {
    snapshot = {
      ...snapshot, state: controller.signal.aborted ? 'cancelled' : 'failed', tool: null,
      error: controller.signal.aborted ? null : {
        code: error instanceof AppError ? error.code : 'AI_PROVIDER_ERROR',
        message: error instanceof AppError ? error.message : 'AI background generation failed',
      },
    }
  } finally {
    reader?.releaseLock()
    persist(true)
    workers.delete(snapshot.id)
  }
}
