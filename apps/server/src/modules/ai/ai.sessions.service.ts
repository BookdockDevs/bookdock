import { and, asc, count, desc, eq, inArray, isNull, max, ne, or } from 'drizzle-orm'

import { AI_DEFAULT_READING_SCOPE, AI_TOOL_NAMES, normalizeAiCitationMarkers, normalizeAiToolName } from '@bookdock/shared'
import type { AiCitation, AiContextReceipt, AiHistoryMessage, AiMessageEventRes, AiMessageRevisionRes, AiReadingScope, AiRetryRecipe, AiThreadCreateReq, AiThreadDetailRes, AiThreadListReq, AiThreadRes, AiThreadSettings, AiThreadUpdateReq, AiToolName } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiMessageEvents, aiMessages, aiThreads, books } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { getLatestAiGenerationRun } from './ai.runs.service'

const DEFAULT_THREAD_TITLE = '新对话'
const MAX_THREAD_TITLE_LENGTH = 100
const DEFAULT_THREAD_SETTINGS: AiThreadSettings = {
  readingScope: AI_DEFAULT_READING_SCOPE,
  enabledTools: [...AI_TOOL_NAMES],
  assistantModeId: 'assistant',
}

interface AiThreadContext {
  threadId: string
  history: AiHistoryMessage[]
  settings: AiThreadSettings
  replaceMessageIds?: string[]
  regenerateUserMessageId?: string
  revisionGroupId?: string
  supersedeAssistantMessageId?: string
}

function normalizeThreadSettings(value: unknown): AiThreadSettings {
  const raw = value && typeof value === 'object' ? value as { readingScope?: unknown; enabledTools?: unknown; assistantModeId?: unknown } : {}
  const readingScope: AiReadingScope = raw.readingScope === 'current_chapter' || raw.readingScope === 'full_book'
    ? raw.readingScope
    : DEFAULT_THREAD_SETTINGS.readingScope
  const enabledTools = Array.isArray(raw.enabledTools)
    ? Array.from(new Set(raw.enabledTools.map(normalizeAiToolName).filter((name): name is AiToolName => Boolean(name))))
    : [...DEFAULT_THREAD_SETTINGS.enabledTools]
  const assistantModeId = typeof raw.assistantModeId === 'string' && raw.assistantModeId.trim()
    ? raw.assistantModeId.trim().slice(0, 100)
    : DEFAULT_THREAD_SETTINGS.assistantModeId
  return { readingScope, enabledTools, assistantModeId }
}

function assertBookOwnership(userId: string, bookId: string) {
  const book = getDb().select({ id: books.id }).from(books).where(and(
    eq(books.id, bookId),
    eq(books.userId, userId),
    isNull(books.deletedAt),
  )).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
}

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, MAX_THREAD_TITLE_LENGTH)
  return title || DEFAULT_THREAD_TITLE
}

function toThreadRes(row: typeof aiThreads.$inferSelect, messageCount: number): AiThreadRes {
  return {
    id: row.id,
    bookId: row.bookId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount,
    settings: normalizeThreadSettings(row.settings),
  }
}

function toMessageEventRes(row: typeof aiMessageEvents.$inferSelect): AiMessageEventRes {
  if (row.type === 'citation') {
    return {
      id: row.id,
      sequence: row.sequence,
      event: { type: 'citation', citationId: row.citationId ?? '' },
      createdAt: row.createdAt,
    }
  }
  return {
    id: row.id,
    sequence: row.sequence,
    event: {
      type: 'tool',
      name: row.name ?? '',
      phase: row.phase === 'result' ? 'result' : 'start',
      ...(row.chapterIndex === null ? {} : { chapterIndex: row.chapterIndex }),
      ...(row.resultChars === null ? {} : { resultChars: row.resultChars }),
    },
    createdAt: row.createdAt,
  }
}

function messageEvents(userId: string, threadId: string, messageIds: string[]) {
  const grouped = new Map<string, AiMessageEventRes[]>()
  if (messageIds.length === 0) return grouped
  const rows = getDb().select().from(aiMessageEvents).where(and(
    eq(aiMessageEvents.userId, userId),
    eq(aiMessageEvents.threadId, threadId),
    inArray(aiMessageEvents.messageId, messageIds),
  )).orderBy(asc(aiMessageEvents.sequence), asc(aiMessageEvents.id)).all()
  for (const row of rows) {
    const events = grouped.get(row.messageId) ?? []
    events.push(toMessageEventRes(row))
    grouped.set(row.messageId, events)
  }
  return grouped
}

function normalizeAiMessage(row: typeof aiMessages.$inferSelect) {
  if (row.role !== 'assistant') return row
  const normalized = row.aborted === 1
    ? normalizeAiCitationMarkers(row.content, [])
    : normalizeAiCitationMarkers(row.content, row.citations ?? [])
  return { ...row, content: normalized.content, citations: normalized.citations.length ? normalized.citations : null }
}

function toMessageRes(row: typeof aiMessages.$inferSelect, events: AiMessageEventRes[] = []) {
  const normalized = normalizeAiMessage(row)
  return {
    id: normalized.id,
    threadId: normalized.threadId,
    role: normalized.role,
    revisionGroupId: normalized.revisionGroupId ?? null,
    revision: normalized.revision,
    content: normalized.content,
    context: normalized.context ?? null,
    retry: normalized.retry ?? null,
    citations: normalized.citations ?? [],
    events,
    createdAt: normalized.createdAt,
    aborted: normalized.aborted === 1,
  }
}

type SelectableAiMessage = typeof aiMessages.$inferSelect & { revisionGroupId: string }

function toMessageRevisionRes(row: SelectableAiMessage, events: AiMessageEventRes[] = []): AiMessageRevisionRes {
  const normalized = normalizeAiMessage(row)
  return {
    id: normalized.id,
    revisionGroupId: normalized.revisionGroupId ?? row.revisionGroupId,
    revision: normalized.revision,
    content: normalized.content,
    citations: normalized.citations ?? [],
    events,
    createdAt: normalized.createdAt,
    aborted: normalized.aborted === 1,
    selected: row.isSelected === 1,
  }
}

function selectableLatestRevision(userId: string, threadId: string, messageId: string): SelectableAiMessage {
  ownedThread(userId, threadId)
  const message = getDb().select().from(aiMessages).where(and(
    eq(aiMessages.id, messageId),
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
    eq(aiMessages.role, 'assistant'),
    ne(aiMessages.content, ''),
    eq(aiMessages.aborted, 0),
  )).get()
  const latest = threadMessages(userId, threadId).at(-1)
  if (!message || !message.revisionGroupId || latest?.role !== 'assistant' || latest.aborted === 1 || latest.revisionGroupId !== message.revisionGroupId) {
    throw new AppError('AI_MESSAGE_NOT_FOUND', 'AI revision is not available')
  }
  return message as SelectableAiMessage
}

function ownedThread(userId: string, threadId: string) {
  const thread = getDb().select().from(aiThreads).where(and(
    eq(aiThreads.id, threadId),
    eq(aiThreads.userId, userId),
  )).get()
  if (!thread) throw new AppError('AI_THREAD_NOT_FOUND', 'AI thread not found')
  assertBookOwnership(userId, thread.bookId)
  return thread
}

function threadMessages(userId: string, threadId: string) {
  return getDb().select().from(aiMessages).where(and(
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
    ne(aiMessages.content, ''),
    or(isNull(aiMessages.revisionGroupId), eq(aiMessages.isSelected, 1)),
  )).orderBy(asc(aiMessages.createdAt), asc(aiMessages.id)).all().map(normalizeAiMessage)
}

export function createAiThread(userId: string, input: AiThreadCreateReq): AiThreadRes {
  assertBookOwnership(userId, input.bookId)
  const now = Date.now()
  const row = {
    id: createId('ai-thread'),
    userId,
    bookId: input.bookId,
    title: input.title?.trim().slice(0, MAX_THREAD_TITLE_LENGTH) || DEFAULT_THREAD_TITLE,
    settings: normalizeThreadSettings(input.settings),
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(aiThreads).values(row).run()
  return toThreadRes(row, 0)
}

export function listAiThreads(userId: string, input: AiThreadListReq): AiThreadRes[] {
  assertBookOwnership(userId, input.bookId)
  const rows = getDb().select({
    id: aiThreads.id,
    userId: aiThreads.userId,
    bookId: aiThreads.bookId,
    title: aiThreads.title,
    settings: aiThreads.settings,
    createdAt: aiThreads.createdAt,
    updatedAt: aiThreads.updatedAt,
    messageCount: count(aiMessages.id),
  }).from(aiThreads)
    .leftJoin(aiMessages, and(
      eq(aiMessages.threadId, aiThreads.id),
      eq(aiMessages.userId, userId),
      ne(aiMessages.content, ''),
      or(isNull(aiMessages.revisionGroupId), eq(aiMessages.isSelected, 1)),
    ))
    .where(and(eq(aiThreads.userId, userId), eq(aiThreads.bookId, input.bookId)))
    .groupBy(aiThreads.id)
    .orderBy(desc(aiThreads.updatedAt), desc(aiThreads.id))
    .limit(input.limit ?? 50)
    .all()

  return rows.map((row) => toThreadRes(row, Number(row.messageCount)))
}

export function getAiThread(userId: string, threadId: string): AiThreadDetailRes {
  const thread = ownedThread(userId, threadId)
  const messages = threadMessages(userId, threadId)
  const events = messageEvents(userId, threadId, messages.map((message) => message.id))
  return { ...toThreadRes(thread, messages.length), messages: messages.map((message) => toMessageRes(message, events.get(message.id) ?? [])), generation: getLatestAiGenerationRun(userId, threadId) }
}

export function listAiMessageRevisions(userId: string, threadId: string, messageId: string): AiMessageRevisionRes[] {
  const target = selectableLatestRevision(userId, threadId, messageId)
  const rows = getDb().select().from(aiMessages).where(and(
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
    eq(aiMessages.role, 'assistant'),
    eq(aiMessages.revisionGroupId, target.revisionGroupId),
    ne(aiMessages.content, ''),
    eq(aiMessages.aborted, 0),
  )).orderBy(asc(aiMessages.revision), asc(aiMessages.createdAt), asc(aiMessages.id)).all() as SelectableAiMessage[]
  const events = messageEvents(userId, threadId, rows.map((row) => row.id))
  return rows.map((row) => toMessageRevisionRes(row, events.get(row.id) ?? []))
}

export function selectAiMessageRevision(userId: string, threadId: string, messageId: string): AiMessageRevisionRes {
  const target = selectableLatestRevision(userId, threadId, messageId)
  const now = Date.now()
  getDb().transaction((tx) => {
    tx.update(aiMessages).set({ isSelected: 0 }).where(and(
      eq(aiMessages.userId, userId),
      eq(aiMessages.threadId, threadId),
      eq(aiMessages.role, 'assistant'),
      eq(aiMessages.revisionGroupId, target.revisionGroupId),
    )).run()
    tx.update(aiMessages).set({ isSelected: 1 }).where(and(
      eq(aiMessages.id, target.id),
      eq(aiMessages.userId, userId),
      eq(aiMessages.threadId, threadId),
      eq(aiMessages.role, 'assistant'),
      eq(aiMessages.revisionGroupId, target.revisionGroupId),
    )).run()
    tx.update(aiThreads).set({ updatedAt: now }).where(and(
      eq(aiThreads.id, threadId),
      eq(aiThreads.userId, userId),
    )).run()
  })
  const events = messageEvents(userId, threadId, [target.id])
  return toMessageRevisionRes({ ...target, isSelected: 1 }, events.get(target.id) ?? [])
}

export function updateAiThread(userId: string, threadId: string, input: AiThreadUpdateReq): AiThreadRes {
  ownedThread(userId, threadId)
  const updatedAt = Date.now()
  const changes: { title?: string; settings?: AiThreadSettings; updatedAt: number } = { updatedAt }
  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, MAX_THREAD_TITLE_LENGTH)
    if (!title) throw new AppError('VALIDATION_ERROR', 'AI thread title is required')
    changes.title = title
  }
  if (input.settings !== undefined) changes.settings = normalizeThreadSettings(input.settings)
  getDb().update(aiThreads).set(changes).where(and(
    eq(aiThreads.id, threadId),
    eq(aiThreads.userId, userId),
  )).run()
  const updated = getDb().select().from(aiThreads).where(and(
    eq(aiThreads.id, threadId),
    eq(aiThreads.userId, userId),
  )).get()
  if (!updated) throw new AppError('AI_THREAD_NOT_FOUND', 'AI thread not found')
  return toThreadRes(updated, threadMessages(userId, threadId).length)
}

export function deleteAiThread(userId: string, threadId: string) {
  ownedThread(userId, threadId)
  getDb().delete(aiThreads).where(and(
    eq(aiThreads.id, threadId),
    eq(aiThreads.userId, userId),
  )).run()
}

export function prepareAiThread(userId: string, bookId: string, threadId: string | undefined, prompt: string, regenerate = false, settings?: Partial<AiThreadSettings>, editMessageId?: string): AiThreadContext {
  if (editMessageId && !threadId) throw new AppError('AI_MESSAGE_NOT_FOUND', 'Only the latest user message can be edited')
  if (threadId) {
    const thread = ownedThread(userId, threadId)
    if (thread.bookId !== bookId) throw new AppError('AI_THREAD_NOT_FOUND', 'AI thread does not belong to this book')
    const effectiveSettings = normalizeThreadSettings({ ...normalizeThreadSettings(thread.settings), ...settings })
    if (settings && (settings.readingScope !== undefined || settings.enabledTools !== undefined || settings.assistantModeId !== undefined)) {
      getDb().update(aiThreads).set({ settings: effectiveSettings, updatedAt: Date.now() }).where(and(
        eq(aiThreads.id, thread.id),
        eq(aiThreads.userId, userId),
      )).run()
    }
    const messages = threadMessages(userId, thread.id)
    const last = messages.at(-1)
    const previous = messages.at(-2)
    const completedTurn = last?.role === 'assistant' && previous?.role === 'user' ? { last, previous } : null
    const userTurn = last?.role === 'user' ? last : null
    const editingCompletedTurn = Boolean(editMessageId && regenerate && completedTurn?.previous.id === editMessageId)
    const editingUserTurn = Boolean(editMessageId && regenerate && userTurn?.id === editMessageId)
    if (editMessageId && !editingCompletedTurn && !editingUserTurn) throw new AppError('AI_MESSAGE_NOT_FOUND', 'Only the latest user message can be edited')
    const regeneratingCompletedTurn = Boolean(regenerate && completedTurn && completedTurn.previous.content === prompt)
    const regeneratingUserTurn = Boolean(regenerate && userTurn && userTurn.content === prompt)
    const replaceMessageIds = (editingCompletedTurn || regeneratingCompletedTurn) && completedTurn
      ? [completedTurn.previous.id, completedTurn.last.id]
      : editingUserTurn || regeneratingUserTurn
        ? userTurn ? [userTurn.id] : []
        : []
    const regenerateUserMessage = (editingCompletedTurn || regeneratingCompletedTurn) && completedTurn ? completedTurn.previous : editingUserTurn || regeneratingUserTurn ? userTurn : undefined
    return {
      threadId: thread.id,
      history: messages.filter((message) => !replaceMessageIds.includes(message.id)).map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.role === 'user' && message.retry?.context ? { context: message.retry.context } : {}),
      })),
      settings: effectiveSettings,
      ...(replaceMessageIds.length > 0 ? { replaceMessageIds } : {}),
      ...(regenerateUserMessage ? {
        regenerateUserMessageId: regenerateUserMessage.id,
        revisionGroupId: regenerateUserMessage.revisionGroupId ?? regenerateUserMessage.id,
      } : {}),
      ...((editingCompletedTurn || regeneratingCompletedTurn) && completedTurn ? { supersedeAssistantMessageId: completedTurn.last.id } : {}),
    }
  }

  const thread = createAiThread(userId, { bookId, title: titleFromPrompt(prompt), settings: normalizeThreadSettings(settings) })
  return { threadId: thread.id, history: [], settings: thread.settings }
}

export function saveAiMessage(
  userId: string,
  threadId: string,
  message: { role: 'user' | 'assistant'; content: string; context?: AiContextReceipt | null; retry?: AiRetryRecipe | null; citations?: AiCitation[]; aborted?: boolean; replaceMessageIds?: string[]; existingMessageId?: string; revisionGroupId?: string | null },
) {
  if (!message.content.trim()) return undefined
  ownedThread(userId, threadId)
  if (message.existingMessageId) {
    const existing = getDb().select().from(aiMessages).where(and(
      eq(aiMessages.id, message.existingMessageId),
      eq(aiMessages.userId, userId),
      eq(aiMessages.threadId, threadId),
      eq(aiMessages.role, 'user'),
    )).get()
    if (!existing) throw new AppError('AI_MESSAGE_NOT_FOUND', 'AI message not found')
    const now = Math.max(Date.now(), existing.createdAt)
    const revisionGroupId = existing.revisionGroupId ?? existing.id
    getDb().transaction((tx) => {
      tx.update(aiMessages).set({
        content: message.content,
        context: message.context ?? null,
        retry: message.retry ?? null,
        citations: message.citations?.length ? message.citations : null,
        revisionGroupId,
        isSelected: 1,
        aborted: message.aborted ? 1 : 0,
      }).where(and(
        eq(aiMessages.id, existing.id),
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, threadId),
        eq(aiMessages.role, 'user'),
      )).run()
      tx.update(aiThreads).set({ updatedAt: now }).where(and(
        eq(aiThreads.id, threadId),
        eq(aiThreads.userId, userId),
      )).run()
    })
    return existing.id
  }
  const latestMessage = getDb().select({ createdAt: aiMessages.createdAt }).from(aiMessages).where(and(
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
  )).orderBy(desc(aiMessages.createdAt)).limit(1).get()
  const now = Math.max(Date.now(), (latestMessage?.createdAt ?? 0) + 1)
  const id = createId('ai-message')
  getDb().transaction((tx) => {
    if (message.replaceMessageIds?.length) {
      tx.delete(aiMessages).where(and(
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, threadId),
        inArray(aiMessages.id, message.replaceMessageIds),
      )).run()
    }
    tx.insert(aiMessages).values({
      id,
      userId,
      threadId,
      role: message.role,
      content: message.content,
      context: message.context ?? null,
      retry: message.retry ?? null,
      citations: message.citations?.length ? message.citations : null,
      revisionGroupId: message.revisionGroupId ?? (message.role === 'user' ? id : null),
      revision: 0,
      isSelected: 1,
      createdAt: now,
      aborted: message.aborted ? 1 : 0,
    }).run()
    tx.update(aiThreads).set({ updatedAt: now }).where(and(
      eq(aiThreads.id, threadId),
      eq(aiThreads.userId, userId),
    )).run()
  })
  return id
}

export function createAiAssistantDraft(userId: string, threadId: string, options?: { revisionGroupId?: string; supersedeMessageId?: string }) {
  ownedThread(userId, threadId)
  const latestMessage = getDb().select({ createdAt: aiMessages.createdAt }).from(aiMessages).where(and(
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
  )).orderBy(desc(aiMessages.createdAt)).limit(1).get()
  const now = Math.max(Date.now(), (latestMessage?.createdAt ?? 0) + 1)
  const id = createId('ai-message')
  const revisionGroupId = options?.revisionGroupId ?? null
  getDb().transaction((tx) => {
    if (options?.supersedeMessageId && revisionGroupId) {
      tx.update(aiMessages).set({ revisionGroupId, revision: 0, isSelected: 0 }).where(and(
        eq(aiMessages.id, options.supersedeMessageId),
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, threadId),
        eq(aiMessages.role, 'assistant'),
      )).run()
    }
    if (revisionGroupId) {
      tx.update(aiMessages).set({ isSelected: 0 }).where(and(
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, threadId),
        eq(aiMessages.role, 'assistant'),
        eq(aiMessages.revisionGroupId, revisionGroupId),
        eq(aiMessages.isSelected, 1),
      )).run()
    }
    const latestRevision = revisionGroupId
      ? tx.select({ revision: max(aiMessages.revision) }).from(aiMessages).where(and(
        eq(aiMessages.userId, userId),
        eq(aiMessages.threadId, threadId),
        eq(aiMessages.role, 'assistant'),
        eq(aiMessages.revisionGroupId, revisionGroupId),
      )).get()?.revision
      : null
    tx.insert(aiMessages).values({
      id,
      userId,
      threadId,
      role: 'assistant',
      content: '',
      context: null,
      retry: null,
      citations: null,
      revisionGroupId,
      revision: revisionGroupId ? Math.max(0, Number(latestRevision ?? -1) + 1) : 0,
      isSelected: 1,
      createdAt: now,
      aborted: 0,
    }).run()
    tx.update(aiThreads).set({ updatedAt: now }).where(and(
      eq(aiThreads.id, threadId),
      eq(aiThreads.userId, userId),
    )).run()
  })
  return id
}

export function updateAiMessageContext(userId: string, threadId: string, messageId: string, context: AiContextReceipt) {
  ownedThread(userId, threadId)
  getDb().update(aiMessages).set({ context }).where(and(
    eq(aiMessages.id, messageId),
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
    eq(aiMessages.role, 'user'),
  )).run()
}
