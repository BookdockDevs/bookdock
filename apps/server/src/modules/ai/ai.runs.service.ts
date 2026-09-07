import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { RunResult } from 'better-sqlite3'
import type { SQLiteTransaction } from 'drizzle-orm/sqlite-core'

import { normalizeAiCitationMarkers } from '@bookdock/shared'
import type { AiCitation, AiGenerationDiagnostics, AiGenerationRunRes, AiGenerationState, AiGenerationTerminalReason, AiGenerationUsage, AiNormalizedEvent } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiGenerationRuns, aiMessageEvents, aiMessages, aiThreads, books } from '../../db/schema'
import type * as dbSchema from '../../db/schema'
import { createId } from '../../lib/id'
import { log } from '../../lib/logger'
import { AppError } from '../../middleware/error'

export const AI_GENERATION_ACTIVE_STATES = ['preparing', 'requesting', 'streaming', 'waiting_tool'] as const
export const AI_GENERATION_TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'interrupted'] as const

type AiGenerationActiveState = (typeof AI_GENERATION_ACTIVE_STATES)[number]
type AiGenerationTerminalState = (typeof AI_GENERATION_TERMINAL_STATES)[number]

const CHECKPOINT_INTERVAL_MS = 250
const MAX_CHECKPOINT_TEXT_CHARS = 12_000
const MAX_CHECKPOINT_EVENTS = 64
const MAX_MESSAGE_EVENTS = 128
const MAX_ERROR_MESSAGE_CHARS = 200

interface AiGenerationCheckpointInput {
  text: string
  events: AiNormalizedEvent[]
  usage: AiGenerationUsage | null
}

interface AiGenerationFinalizeInput extends AiGenerationCheckpointInput {
  state: AiGenerationTerminalState
  reason?: AiGenerationTerminalReason | null
  errorCode?: string | null
  errorMessage?: string | null
  citations: AiCitation[]
  aborted?: boolean
  diagnostics?: AiGenerationDiagnostics | null
}

function isActiveState(state: AiGenerationState): state is AiGenerationActiveState {
  return (AI_GENERATION_ACTIVE_STATES as readonly string[]).includes(state)
}

function isTerminalState(state: AiGenerationState): state is AiGenerationTerminalState {
  return (AI_GENERATION_TERMINAL_STATES as readonly string[]).includes(state)
}

function boundedText(value: string) {
  return value.slice(0, MAX_CHECKPOINT_TEXT_CHARS)
}

function boundedEvents(events: readonly AiNormalizedEvent[]): AiNormalizedEvent[] {
  return events.slice(-MAX_CHECKPOINT_EVENTS).flatMap((event): AiNormalizedEvent[] => {
    if (event.type === 'citation') {
      const citationId = event.citationId.trim().slice(0, 100)
      return citationId ? [{ type: 'citation' as const, citationId }] : []
    }
    return [{
      type: 'tool' as const,
      name: event.name.slice(0, 100),
      phase: event.phase,
      ...(event.chapterIndex === undefined ? {} : { chapterIndex: event.chapterIndex }),
      ...(event.resultChars === undefined ? {} : { resultChars: event.resultChars }),
    }]
  })
}

type AiDbTransaction = SQLiteTransaction<'sync', RunResult, typeof dbSchema, ExtractTablesWithRelations<typeof dbSchema>>

function persistAiMessageEvents(tx: AiDbTransaction, userId: string, threadId: string, messageId: string, events: readonly AiNormalizedEvent[], createdAt: number) {
  tx.delete(aiMessageEvents).where(and(
    eq(aiMessageEvents.messageId, messageId),
    eq(aiMessageEvents.userId, userId),
    eq(aiMessageEvents.threadId, threadId),
  )).run()
  const rows: (typeof aiMessageEvents.$inferInsert)[] = events.slice(-MAX_MESSAGE_EVENTS).flatMap((event, sequence): (typeof aiMessageEvents.$inferInsert)[] => {
    if (event.type === 'citation') {
      const citationId = event.citationId.trim().slice(0, 100)
      return citationId ? [{
        id: createId('ai-event'),
        userId,
        threadId,
        messageId,
        sequence,
        type: 'citation' as const,
        phase: null,
        name: null,
        chapterIndex: null,
        resultChars: null,
        citationId,
        createdAt: createdAt + sequence,
      }] : []
    }
    return [{
      id: createId('ai-event'),
      userId,
      threadId,
      messageId,
      sequence,
      type: 'tool' as const,
      phase: event.phase,
      name: event.name.slice(0, 100),
      chapterIndex: event.chapterIndex ?? null,
      resultChars: event.resultChars ?? null,
      citationId: null,
      createdAt: createdAt + sequence,
    }]
  })
  if (rows.length > 0) tx.insert(aiMessageEvents).values(rows).run()
}

function boundedUsage(usage: AiGenerationUsage | null | undefined): AiGenerationUsage | null {
  if (!usage) return null
  const inputTokens = Number.isSafeInteger(usage.inputTokens) && usage.inputTokens! >= 0 ? usage.inputTokens : undefined
  const outputTokens = Number.isSafeInteger(usage.outputTokens) && usage.outputTokens! >= 0 ? usage.outputTokens : undefined
  return inputTokens === undefined && outputTokens === undefined ? null : {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  }
}

function boundedDiagnostics(diagnostics: AiGenerationDiagnostics | null | undefined): AiGenerationDiagnostics | null {
  if (!diagnostics) return null
  const nonNegative = (value: number | undefined) => Number.isFinite(value) && value !== undefined ? Math.max(0, Math.round(value)) : 0
  return {
    provider: diagnostics.provider,
    ...(diagnostics.model ? { model: diagnostics.model.slice(0, 200) } : {}),
    providerRequestCount: nonNegative(diagnostics.providerRequestCount),
    ...(diagnostics.timeToFirstTokenMs === undefined ? {} : { timeToFirstTokenMs: nonNegative(diagnostics.timeToFirstTokenMs) }),
    ...(diagnostics.totalDurationMs === undefined ? {} : { totalDurationMs: nonNegative(diagnostics.totalDurationMs) }),
    ...(diagnostics.contextChars === undefined ? {} : { contextChars: nonNegative(diagnostics.contextChars) }),
    ...(diagnostics.sentMessageChars === undefined ? {} : { sentMessageChars: nonNegative(diagnostics.sentMessageChars) }),
    ...(diagnostics.droppedHistoryChars === undefined ? {} : { droppedHistoryChars: nonNegative(diagnostics.droppedHistoryChars) }),
    toolSteps: nonNegative(diagnostics.toolSteps),
    toolCalls: nonNegative(diagnostics.toolCalls),
    toolResultChars: nonNegative(diagnostics.toolResultChars),
    retrievalQueries: nonNegative(diagnostics.retrievalQueries),
    retrievalLexicalCandidates: nonNegative(diagnostics.retrievalLexicalCandidates),
    retrievalSemanticCandidates: nonNegative(diagnostics.retrievalSemanticCandidates),
    retrievalSelectedResults: nonNegative(diagnostics.retrievalSelectedResults),
    retrievalFallbacks: nonNegative(diagnostics.retrievalFallbacks),
    outputChars: nonNegative(diagnostics.outputChars),
  }
}

function toRunRes(row: typeof aiGenerationRuns.$inferSelect): AiGenerationRunRes {
  return {
    id: row.id,
    requestId: row.requestId,
    threadId: row.threadId,
    targetMessageId: row.targetMessageId,
    state: row.state,
    stateRevision: row.stateRevision,
    checkpointSeq: row.checkpointSeq,
    checkpointText: row.checkpointText,
    checkpointEvents: row.checkpointEvents ?? [],
    checkpointUsage: row.checkpointUsage ?? null,
    diagnostics: row.diagnostics ?? null,
    errorCode: (row.errorCode as AiGenerationRunRes['errorCode']) ?? null,
    reason: row.reason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    terminalAt: row.terminalAt ?? null,
  }
}

function ownedRun(userId: string, runId: string) {
  const row = getDb().select().from(aiGenerationRuns).where(and(
    eq(aiGenerationRuns.id, runId),
    eq(aiGenerationRuns.userId, userId),
  )).get()
  if (!row) throw new AppError('AI_RUN_NOT_FOUND', 'AI generation run not found')

  const thread = getDb().select({ bookId: aiThreads.bookId }).from(aiThreads).where(and(
    eq(aiThreads.id, row.threadId),
    eq(aiThreads.userId, userId),
  )).get()
  if (!thread) throw new AppError('AI_RUN_NOT_FOUND', 'AI generation run not found')

  const book = getDb().select({ id: books.id }).from(books).where(and(
    eq(books.id, thread.bookId),
    eq(books.userId, userId),
    isNull(books.deletedAt),
  )).get()
  if (!book) throw new AppError('AI_RUN_NOT_FOUND', 'AI generation run not found')
  return row
}

export function startAiGenerationRun(userId: string, threadId: string, requestId: string): AiGenerationRunRes {
  const now = Date.now()
  const row = {
    id: createId('ai-run'),
    userId,
    threadId,
    requestId,
    targetMessageId: null,
    state: 'preparing' as const,
    stateRevision: 0,
    checkpointSeq: 0,
    checkpointText: '',
    checkpointEvents: null,
    checkpointUsage: null,
    diagnostics: null,
    errorCode: null,
    reason: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    terminalAt: null,
  }
  try {
    getDb().insert(aiGenerationRuns).values(row).run()
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      throw new AppError('AI_BUSY', 'Another AI request is already running')
    }
    throw error
  }
  return toRunRes(row)
}

export function setAiGenerationTargetMessage(userId: string, runId: string, targetMessageId: string) {
  const run = ownedRun(userId, runId)
  if (run.state !== 'preparing' || run.targetMessageId !== null) throw new AppError('AI_RUN_CONFLICT', 'AI generation run is not preparing')
  const target = getDb().select({ id: aiMessages.id }).from(aiMessages).where(and(
    eq(aiMessages.id, targetMessageId),
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, run.threadId),
    eq(aiMessages.role, 'assistant'),
  )).get()
  if (!target) throw new AppError('AI_RUN_CONFLICT', 'AI generation target message is invalid')
  getDb().update(aiGenerationRuns).set({ targetMessageId, updatedAt: Date.now() }).where(and(
    eq(aiGenerationRuns.id, runId),
    eq(aiGenerationRuns.userId, userId),
    eq(aiGenerationRuns.state, 'preparing'),
    eq(aiGenerationRuns.stateRevision, run.stateRevision),
  )).run()
}

export function transitionAiGenerationRun(userId: string, runId: string, expectedState: AiGenerationActiveState, nextState: AiGenerationState): AiGenerationRunRes {
  if (nextState !== 'preparing' && nextState !== 'requesting' && nextState !== 'streaming' && nextState !== 'waiting_tool' && !isTerminalState(nextState)) {
    throw new AppError('AI_RUN_CONFLICT', 'Invalid AI generation state transition')
  }
  const current = ownedRun(userId, runId)
  if (current.state !== expectedState) throw new AppError('AI_RUN_CONFLICT', 'AI generation state changed')
  const terminal = isTerminalState(nextState)
  const updated = getDb().update(aiGenerationRuns).set({
    state: nextState,
    stateRevision: sql`${aiGenerationRuns.stateRevision} + 1`,
    updatedAt: Date.now(),
    terminalAt: terminal ? Date.now() : null,
  }).where(and(
    eq(aiGenerationRuns.id, runId),
    eq(aiGenerationRuns.userId, userId),
    eq(aiGenerationRuns.state, expectedState),
    eq(aiGenerationRuns.stateRevision, current.stateRevision),
  )).run()
  if (updated.changes !== 1) throw new AppError('AI_RUN_CONFLICT', 'AI generation state changed')
  return toRunRes(ownedRun(userId, runId))
}

export function checkpointAiGenerationRun(userId: string, runId: string, seq: number, checkpoint: AiGenerationCheckpointInput) {
  const current = ownedRun(userId, runId)
  if (!isActiveState(current.state) || seq <= current.checkpointSeq) return toRunRes(current)
  getDb().update(aiGenerationRuns).set({
    checkpointSeq: seq,
    checkpointText: boundedText(checkpoint.text),
    checkpointEvents: boundedEvents(checkpoint.events),
    checkpointUsage: boundedUsage(checkpoint.usage),
    updatedAt: Date.now(),
  }).where(and(
    eq(aiGenerationRuns.id, runId),
    eq(aiGenerationRuns.userId, userId),
    inArray(aiGenerationRuns.state, [...AI_GENERATION_ACTIVE_STATES]),
    lt(aiGenerationRuns.checkpointSeq, seq),
  )).run()
  return toRunRes(ownedRun(userId, runId))
}

export function createAiCheckpointWriter(userId: string, runId: string, initialSeq: number) {
  let nextSeq = initialSeq
  let pending: AiGenerationCheckpointInput | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const flush = () => {
    if (!pending || closed) return
    const value = pending
    pending = null
    nextSeq += 1
    try {
      checkpointAiGenerationRun(userId, runId, nextSeq, value)
    } catch (error) {
      log('warn', 'ai.generation.checkpoint_failed', { meta: { runId, checkpointSeq: nextSeq }, error })
    }
  }

  return {
    schedule(value: AiGenerationCheckpointInput) {
      if (closed) return
      pending = value
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        flush()
      }, CHECKPOINT_INTERVAL_MS)
    },
    close() {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      const value = pending
      pending = null
      if (!value) return
      nextSeq += 1
      try {
        checkpointAiGenerationRun(userId, runId, nextSeq, value)
      } catch (error) {
        log('warn', 'ai.generation.checkpoint_failed', { meta: { runId, checkpointSeq: nextSeq }, error })
      }
    },
  }
}

export function finalizeAiGenerationRun(userId: string, runId: string, input: AiGenerationFinalizeInput): AiGenerationRunRes {
  const db = getDb()
  const result = db.transaction((tx) => {
    const current = tx.select().from(aiGenerationRuns).where(and(
      eq(aiGenerationRuns.id, runId),
      eq(aiGenerationRuns.userId, userId),
    )).get()
    if (!current) throw new AppError('AI_RUN_NOT_FOUND', 'AI generation run not found')
    if (current.state === 'completed') return current

    const rawContent = input.text.trim()
      ? input.text
      : input.state === 'cancelled'
        ? '（已停止）'
        : input.state === 'failed'
          ? '请求失败，请稍后重试。'
          : input.state === 'completed'
            ? '未收到有效回答，请重试。'
            : '生成已中断，请重试。'
    const normalized = input.state === 'completed'
      ? normalizeAiCitationMarkers(rawContent, input.citations)
      : normalizeAiCitationMarkers(rawContent, [])
    const citations = normalized.citations.length ? normalized.citations : null
    const content = normalized.content
    const selectedCitationIds = new Set(normalized.citations.map((citation) => citation.id))
    const normalizedEvents = input.events.filter((event) => event.type !== 'citation' || selectedCitationIds.has(event.citationId))
    const knownCitationIds = new Set(normalizedEvents.flatMap((event) => event.type === 'citation' ? [event.citationId] : []))
    for (const citation of normalized.citations) {
      if (knownCitationIds.has(citation.id)) continue
      knownCitationIds.add(citation.id)
      normalizedEvents.push({ type: 'citation', citationId: citation.id })
    }
    const targetMessage = current.targetMessageId
      ? tx.select({ id: aiMessages.id }).from(aiMessages).where(and(
        eq(aiMessages.id, current.targetMessageId),
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, current.threadId),
        eq(aiMessages.role, 'assistant'),
      )).get()
      : undefined
    let targetMessageId = targetMessage?.id ?? current.targetMessageId
    if (targetMessage) {
      tx.update(aiMessages).set({ content, citations, aborted: input.aborted ? 1 : 0 }).where(and(
        eq(aiMessages.id, targetMessage.id),
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, current.threadId),
      )).run()
    } else {
      targetMessageId = createId('ai-message')
      tx.insert(aiMessages).values({
        id: targetMessageId,
        userId,
        threadId: current.threadId,
        role: 'assistant',
        content,
        context: null,
        retry: null,
        citations,
        createdAt: Math.max(Date.now(), current.createdAt + 1),
        aborted: input.aborted ? 1 : 0,
      }).run()
    }
    if (!targetMessageId) throw new AppError('AI_RUN_CONFLICT', 'AI generation target message is missing')
    const now = Date.now()
    persistAiMessageEvents(tx, userId, current.threadId, targetMessageId, normalizedEvents, now)
    tx.update(aiThreads).set({ updatedAt: Date.now() }).where(and(
      eq(aiThreads.id, current.threadId),
      eq(aiThreads.userId, userId),
    )).run()

    if (!isActiveState(current.state)) {
      tx.update(aiGenerationRuns).set({
        targetMessageId,
        checkpointSeq: current.checkpointSeq + 1,
        checkpointText: boundedText(content),
        checkpointEvents: boundedEvents(normalizedEvents),
        checkpointUsage: boundedUsage(input.usage),
        diagnostics: boundedDiagnostics(input.diagnostics),
        updatedAt: now,
      }).where(and(
        eq(aiGenerationRuns.id, runId),
        eq(aiGenerationRuns.userId, userId),
        eq(aiGenerationRuns.state, current.state),
        eq(aiGenerationRuns.stateRevision, current.stateRevision),
      )).run()
      return tx.select().from(aiGenerationRuns).where(eq(aiGenerationRuns.id, runId)).get()!
    }

    tx.update(aiGenerationRuns).set({
      targetMessageId,
      state: input.state,
      stateRevision: sql`${aiGenerationRuns.stateRevision} + 1`,
      checkpointSeq: current.checkpointSeq + 1,
      checkpointText: boundedText(content),
      checkpointEvents: boundedEvents(normalizedEvents),
      checkpointUsage: boundedUsage(input.usage),
      diagnostics: boundedDiagnostics(input.diagnostics),
      errorCode: input.errorCode ?? null,
      reason: input.reason ?? null,
      errorMessage: input.errorMessage?.slice(0, MAX_ERROR_MESSAGE_CHARS) ?? null,
      updatedAt: now,
      terminalAt: now,
    }).where(and(
      eq(aiGenerationRuns.id, runId),
      eq(aiGenerationRuns.userId, userId),
      eq(aiGenerationRuns.state, current.state),
      eq(aiGenerationRuns.stateRevision, current.stateRevision),
    )).run()
    return tx.select().from(aiGenerationRuns).where(eq(aiGenerationRuns.id, runId)).get()!
  })
  return toRunRes(result)
}

export function getAiGenerationRun(userId: string, runId: string) {
  return toRunRes(ownedRun(userId, runId))
}

export function getLatestAiGenerationRun(userId: string, threadId: string) {
  const row = getDb().select().from(aiGenerationRuns).where(and(
    eq(aiGenerationRuns.userId, userId),
    eq(aiGenerationRuns.threadId, threadId),
  )).orderBy(desc(aiGenerationRuns.createdAt), desc(aiGenerationRuns.id)).limit(1).get()
  return row ? toRunRes(row) : null
}

export function cancelAiGenerationRun(userId: string, runId: string) {
  const current = ownedRun(userId, runId)
  if (!isActiveState(current.state)) return toRunRes(current)
  const now = Date.now()
  const updated = getDb().update(aiGenerationRuns).set({
    state: 'cancelled',
    stateRevision: sql`${aiGenerationRuns.stateRevision} + 1`,
    reason: 'user_cancelled',
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
    terminalAt: now,
  }).where(and(
    eq(aiGenerationRuns.id, runId),
    eq(aiGenerationRuns.userId, userId),
    eq(aiGenerationRuns.state, current.state),
    eq(aiGenerationRuns.stateRevision, current.stateRevision),
  )).run()
  if (updated.changes !== 1) throw new AppError('AI_RUN_CONFLICT', 'AI generation state changed')
  return toRunRes(ownedRun(userId, runId))
}

export function interruptStaleAiGenerationRuns() {
  const now = Date.now()
  const updated = getDb().update(aiGenerationRuns).set({
    state: 'interrupted',
    stateRevision: sql`${aiGenerationRuns.stateRevision} + 1`,
    reason: 'server_restarted',
    errorMessage: 'The server restarted while this generation was running',
    updatedAt: now,
    terminalAt: now,
  }).where(inArray(aiGenerationRuns.state, [...AI_GENERATION_ACTIVE_STATES])).run()
  return updated.changes
}
