import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { InteractionNotification, NotificationPage, NotificationQuery, NotificationTarget } from '@bookdock/shared'
import { reviewExcerpt } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookReviewCommentLikes, bookReviewComments, bookReviewLikes, ideaCommentLikes, ideaComments, ideaLikes, interactionNotifications, users } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { readableIdea } from '../annotations/idea-access'
import { assertSourceWorkReadable, readableReview } from '../reviews/review-access'

type NotificationRow = typeof interactionNotifications.$inferSelect

async function project(userId: string, row: NotificationRow): Promise<InteractionNotification | null> {
  const db = getDb()
  let preview: string
  try {
    if (row.domain === 'idea') {
      const { row: idea } = await readableIdea(userId, row.targetId)
      if (idea.visibility !== 'shared') return null
      preview = idea.note ?? idea.text
    } else {
      const { row: review } = await readableReview(userId, row.targetId)
      if (review.visibility !== 'shared' || !review.sourceLibraryId || !review.sourceLibraryBookId) return null
      await assertSourceWorkReadable(userId, review.sourceLibraryId, review.sourceLibraryBookId)
      preview = reviewExcerpt(review.body ?? '', review.bodyFormat, 180)
    }
    if (row.commentId) {
      const table = row.domain === 'idea' ? ideaComments : bookReviewComments
      const comment = db.select().from(table).where(and(eq(table.id, row.commentId), isNull(table.deletedAt))).get()
      if (!comment || ('ideaId' in comment ? comment.ideaId : comment.reviewId) !== row.targetId) return null
      preview = comment.body
    }
    if (row.event === 'like') {
      if (row.commentId) {
        const table = row.domain === 'idea' ? ideaCommentLikes : bookReviewCommentLikes
        if (!db.select().from(table).where(and(eq(table.commentId, row.commentId), eq(table.userId, row.actorId))).get()) return null
      } else if (row.domain === 'idea') {
        if (!db.select().from(ideaLikes).where(and(eq(ideaLikes.ideaId, row.targetId), eq(ideaLikes.userId, row.actorId))).get()) return null
      } else if (!db.select().from(bookReviewLikes).where(and(eq(bookReviewLikes.reviewId, row.targetId), eq(bookReviewLikes.userId, row.actorId))).get()) return null
    }
  } catch (error) {
    if (error instanceof AppError) return null
    throw error
  }
  const actor = db.select().from(users).where(eq(users.id, row.actorId)).get()
  if (!actor) return null
  return {
    id: row.id, domain: row.domain, event: row.event, targetId: row.targetId, commentId: row.commentId,
    actor: { id: actor.id, name: actor.username, avatarKey: actor.avatarKey },
    preview: preview.slice(0, 180), createdAt: row.createdAt, readAt: row.readAt,
  }
}

async function* availableNotifications(userId: string, unreadOnly = false) {
  const db = getDb()
  for (let offset = 0; ; offset += 50) {
    const rows = db.select().from(interactionNotifications).where(and(
      eq(interactionNotifications.userId, userId), unreadOnly ? isNull(interactionNotifications.readAt) : undefined,
    )).orderBy(desc(interactionNotifications.createdAt), desc(interactionNotifications.id)).limit(50).offset(offset).all()
    for (const row of rows) {
      const notification = await project(userId, row)
      if (notification) yield notification
    }
    if (rows.length < 50) break
  }
}

export async function listNotifications(userId: string, query: NotificationQuery): Promise<NotificationPage> {
  const entries: InteractionNotification[] = []
  let skipped = 0
  for await (const entry of availableNotifications(userId, query.unread)) {
    if (skipped++ < (query.page - 1) * query.pageSize) continue
    entries.push(entry)
    if (entries.length > query.pageSize) break
  }
  return { entries: entries.slice(0, query.pageSize), page: query.page, hasMore: entries.length > query.pageSize }
}

export function deleteNotification(userId: string, id: string) {
  getDb().delete(interactionNotifications)
    .where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).run()
}

export async function unreadNotificationCount(userId: string) {
  const db = getDb()
  const raw = db.select({ count: sql<number>`count(*)` })
    .from(interactionNotifications)
    .where(and(eq(interactionNotifications.userId, userId), isNull(interactionNotifications.readAt)))
    .get()
  if (!raw || raw.count === 0) return { count: 0 }

  let count = 0
  for await (const _entry of availableNotifications(userId, true)) count += 1
  return { count }
}

export async function notificationTarget(userId: string, id: string): Promise<NotificationTarget> {
  const row = getDb().select().from(interactionNotifications).where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).get()
  const notification = row ? await project(userId, row) : null
  return notification ? { available: true, notification } : { available: false }
}

export function markNotificationRead(userId: string, id: string, read: boolean) {
  getDb().update(interactionNotifications).set({ readAt: read ? Date.now() : null })
    .where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).run()
}

export async function markAllNotificationsRead(userId: string) {
  const db = getDb()
  let ids: string[] = []
  // Scan all rows: read-state writes must not move the unread offset underneath us.
  for await (const entry of availableNotifications(userId)) {
    if (entry.readAt !== null) continue
    ids.push(entry.id)
    if (ids.length === 50) {
      db.update(interactionNotifications).set({ readAt: Date.now() }).where(and(eq(interactionNotifications.userId, userId), inArray(interactionNotifications.id, ids))).run()
      ids = []
    }
  }
  if (ids.length) db.update(interactionNotifications).set({ readAt: Date.now() }).where(and(eq(interactionNotifications.userId, userId), inArray(interactionNotifications.id, ids))).run()
}
