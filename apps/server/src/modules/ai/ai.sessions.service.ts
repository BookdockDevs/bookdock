import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'

import { AI_DEFAULT_READING_SCOPE, AI_TOOL_NAMES } from '@bookdock/shared'
import type { AiCitation, AiContextReceipt, AiHistoryMessage, AiReadingScope, AiThreadCreateReq, AiThreadDetailRes, AiThreadListReq, AiThreadRes, AiThreadSettings, AiThreadUpdateReq, AiToolName } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiMessages, aiThreads, books } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'

const DEFAULT_THREAD_TITLE = '新对话'
const MAX_THREAD_TITLE_LENGTH = 100
const DEFAULT_THREAD_SETTINGS: AiThreadSettings = {
  readingScope: AI_DEFAULT_READING_SCOPE,
  enabledTools: [...AI_TOOL_NAMES],
}

interface AiThreadContext {
  threadId: string
  history: AiHistoryMessage[]
  settings: AiThreadSettings
  replaceMessageIds?: string[]
}

function normalizeThreadSettings(value: unknown): AiThreadSettings {
  const raw = value && typeof value === 'object' ? value as { readingScope?: unknown; enabledTools?: unknown } : {}
  const readingScope: AiReadingScope = raw.readingScope === 'current_chapter' || raw.readingScope === 'full_book'
    ? raw.readingScope
    : DEFAULT_THREAD_SETTINGS.readingScope
  const enabledTools = Array.isArray(raw.enabledTools)
    ? Array.from(new Set(raw.enabledTools.filter((name): name is AiToolName => typeof name === 'string' && AI_TOOL_NAMES.includes(name as AiToolName))))
    : [...DEFAULT_THREAD_SETTINGS.enabledTools]
  return { readingScope, enabledTools }
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

function toMessageRes(row: typeof aiMessages.$inferSelect) {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    context: row.context ?? null,
    citations: row.citations ?? [],
    createdAt: row.createdAt,
    aborted: row.aborted === 1,
  }
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
  )).orderBy(asc(aiMessages.createdAt), asc(aiMessages.id)).all()
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
  return { ...toThreadRes(thread, messages.length), messages: messages.map(toMessageRes) }
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

export function prepareAiThread(userId: string, bookId: string, threadId: string | undefined, prompt: string, regenerate = false, settings?: Partial<AiThreadSettings>): AiThreadContext {
  if (threadId) {
    const thread = ownedThread(userId, threadId)
    if (thread.bookId !== bookId) throw new AppError('AI_THREAD_NOT_FOUND', 'AI thread does not belong to this book')
    const effectiveSettings = normalizeThreadSettings({ ...normalizeThreadSettings(thread.settings), ...settings })
    if (settings && (settings.readingScope !== undefined || settings.enabledTools !== undefined)) {
      getDb().update(aiThreads).set({ settings: effectiveSettings, updatedAt: Date.now() }).where(and(
        eq(aiThreads.id, thread.id),
        eq(aiThreads.userId, userId),
      )).run()
    }
    const messages = threadMessages(userId, thread.id)
    const last = messages.at(-1)
    const previous = messages.at(-2)
    const replaceMessageIds = regenerate && last?.role === 'assistant' && previous?.role === 'user' && previous.content === prompt
      ? [previous.id, last.id]
      : regenerate && last?.role === 'user' && last.content === prompt
        ? [last.id]
        : []
    return {
      threadId: thread.id,
      history: messages.filter((message) => !replaceMessageIds.includes(message.id)).map((message) => ({ role: message.role, content: message.content })),
      settings: effectiveSettings,
      ...(replaceMessageIds.length > 0 ? { replaceMessageIds } : {}),
    }
  }

  const thread = createAiThread(userId, { bookId, title: titleFromPrompt(prompt), settings: normalizeThreadSettings(settings) })
  return { threadId: thread.id, history: [], settings: thread.settings }
}

export function saveAiMessage(
  userId: string,
  threadId: string,
  message: { role: 'user' | 'assistant'; content: string; context?: AiContextReceipt | null; citations?: AiCitation[]; aborted?: boolean; replaceMessageIds?: string[] },
) {
  if (!message.content.trim()) return undefined
  ownedThread(userId, threadId)
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
      citations: message.citations?.length ? message.citations : null,
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

export function updateAiMessageContext(userId: string, threadId: string, messageId: string, context: AiContextReceipt) {
  ownedThread(userId, threadId)
  getDb().update(aiMessages).set({ context }).where(and(
    eq(aiMessages.id, messageId),
    eq(aiMessages.userId, userId),
    eq(aiMessages.threadId, threadId),
    eq(aiMessages.role, 'user'),
  )).run()
}
