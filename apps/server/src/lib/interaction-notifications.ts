import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import type { NotificationDomain, NotificationEvent } from '@bookdock/shared'

import type { getDb } from '../db/client'
import { interactionNotifications, interactionReceipts } from '../db/schema'
import { invalidateUnreadNotificationCount } from '../modules/notifications/notifications.service'
import { AppError } from '../middleware/error'
import { createId } from './id'

type WriteDb = Pick<ReturnType<typeof getDb>, 'insert' | 'select'>

export function recordInteractionNotification(db: WriteDb, input: {
  userId: string | null; actorId: string; domain: NotificationDomain; event: NotificationEvent
  targetId: string; interactionId: string; commentId?: string
}) {
  if (!input.userId || input.userId === input.actorId) return
  db.insert(interactionNotifications).values({ ...input, userId: input.userId, id: createId('ntf'), createdAt: Date.now() })
    .onConflictDoNothing().run()
  invalidateUnreadNotificationCount(input.userId)
}

export function findCommentReceipt(db: WriteDb, userId: string, domain: NotificationDomain, targetId: string,
  input: { requestId?: string; body: string; replyToId?: string }) {
  if (!input.requestId) return null
  const receipt = db.select().from(interactionReceipts).where(and(
    eq(interactionReceipts.userId, userId), eq(interactionReceipts.domain, domain), eq(interactionReceipts.requestId, input.requestId),
  )).get()
  if (!receipt) return null
  const payloadHash = createHash('sha256').update(JSON.stringify([targetId, input.body, input.replyToId ?? null])).digest('hex')
  if (receipt.targetId !== targetId || receipt.payloadHash !== payloadHash) {
    throw new AppError('VALIDATION_ERROR', 'Request ID was already used for another comment')
  }
  return receipt.resultId
}

export function saveCommentReceipt(db: WriteDb, userId: string, domain: NotificationDomain, targetId: string,
  input: { requestId?: string; body: string; replyToId?: string }, resultId: string) {
  if (!input.requestId) return
  db.insert(interactionReceipts).values({
    id: createId('receipt'), userId, domain, targetId, requestId: input.requestId,
    payloadHash: createHash('sha256').update(JSON.stringify([targetId, input.body, input.replyToId ?? null])).digest('hex'), resultId,
  }).run()
}
