import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { InteractionNotification, NotificationPage, NotificationQuery, NotificationTarget } from '@bookdock/shared'
import { reviewExcerpt } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookReviewCommentLikes, bookReviewComments, bookReviewLikes, bookReviews, ideaCommentLikes, ideaComments, ideaLikes, ideas, interactionNotifications, users } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertIdeaSource } from '../annotations/idea-access'
import { assertSourceWorkReadable } from '../reviews/review-access'

type NotificationRow = typeof interactionNotifications.$inferSelect
type IdeaRow = typeof ideas.$inferSelect
type ReviewRow = typeof bookReviews.$inferSelect
type CommentRow = typeof ideaComments.$inferSelect | typeof bookReviewComments.$inferSelect

interface NotificationAvailability {
  row: NotificationRow
  target: IdeaRow | ReviewRow
  comment: CommentRow | null
}

interface NotificationBatchContext {
  ideaSources: Map<string, Promise<boolean>>
  reviewSources: Map<string, Promise<boolean>>
}

function isExpectedUnavailable(error: unknown) {
  return error instanceof AppError
}

function cachedPermission(
  cache: Map<string, Promise<boolean>>,
  key: string,
  check: () => Promise<void>,
) {
  const existing = cache.get(key)
  if (existing) return existing
  const result = (async () => {
    try {
      await check()
      return true
    } catch (error) {
      if (isExpectedUnavailable(error)) return false
      throw error
    }
  })()
  cache.set(key, result)
  return result
}

async function loadNotificationAvailability(
  userId: string,
  rows: NotificationRow[],
  context: NotificationBatchContext,
): Promise<NotificationAvailability[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ideaIds = [...new Set(rows.filter((row) => row.domain === 'idea').map((row) => row.targetId))]
  const reviewIds = [...new Set(rows.filter((row) => row.domain === 'review').map((row) => row.targetId))]
  const ideaById = new Map(db.select().from(ideas).where(inArray(ideas.id, ideaIds)).all().map((row) => [row.id, row]))
  const reviewById = new Map(db.select().from(bookReviews).where(inArray(bookReviews.id, reviewIds)).all().map((row) => [row.id, row]))

  const ideaCommentIds = [...new Set(rows.filter((row) => row.domain === 'idea' && row.commentId).map((row) => row.commentId!))]
  const reviewCommentIds = [...new Set(rows.filter((row) => row.domain === 'review' && row.commentId).map((row) => row.commentId!))]
  const ideaCommentsById = new Map(db.select().from(ideaComments)
    .where(and(inArray(ideaComments.id, ideaCommentIds), isNull(ideaComments.deletedAt))).all().map((row) => [row.id, row]))
  const reviewCommentsById = new Map(db.select().from(bookReviewComments)
    .where(and(inArray(bookReviewComments.id, reviewCommentIds), isNull(bookReviewComments.deletedAt))).all().map((row) => [row.id, row]))

  const actorIds = [...new Set(rows.map((row) => row.actorId))]
  const actorIdsById = new Set(db.select({ id: users.id }).from(users).where(inArray(users.id, actorIds)).all().map((row) => row.id))
  const ideaLikeKeys = new Set(db.select({ ideaId: ideaLikes.ideaId, userId: ideaLikes.userId }).from(ideaLikes)
    .where(and(inArray(ideaLikes.ideaId, ideaIds), inArray(ideaLikes.userId, actorIds))).all().map((row) => `${row.ideaId}:${row.userId}`))
  const reviewLikeKeys = new Set(db.select({ reviewId: bookReviewLikes.reviewId, userId: bookReviewLikes.userId }).from(bookReviewLikes)
    .where(and(inArray(bookReviewLikes.reviewId, reviewIds), inArray(bookReviewLikes.userId, actorIds))).all().map((row) => `${row.reviewId}:${row.userId}`))
  const ideaCommentLikeKeys = new Set(db.select({ commentId: ideaCommentLikes.commentId, userId: ideaCommentLikes.userId }).from(ideaCommentLikes)
    .where(and(inArray(ideaCommentLikes.commentId, ideaCommentIds), inArray(ideaCommentLikes.userId, actorIds))).all().map((row) => `${row.commentId}:${row.userId}`))
  const reviewCommentLikeKeys = new Set(db.select({ commentId: bookReviewCommentLikes.commentId, userId: bookReviewCommentLikes.userId }).from(bookReviewCommentLikes)
    .where(and(inArray(bookReviewCommentLikes.commentId, reviewCommentIds), inArray(bookReviewCommentLikes.userId, actorIds))).all().map((row) => `${row.commentId}:${row.userId}`))

  const available: NotificationAvailability[] = []
  for (const row of rows) {
    if (!actorIdsById.has(row.actorId)) continue
    let target: IdeaRow | ReviewRow | undefined
    let comment: CommentRow | null = null
    let permissionKey: string | null = null
    let permitted: Promise<boolean>
    if (row.domain === 'idea') {
      const idea = ideaById.get(row.targetId)
      if (!idea || idea.deletedAt || idea.visibility !== 'shared' || !idea.sharedLibraryId || !idea.sourceLibraryBookVersionId || !idea.bookVersionId) continue
      target = idea
      permissionKey = `${idea.sharedLibraryId}:${idea.sourceLibraryBookVersionId}:${idea.bookVersionId}`
      permitted = cachedPermission(context.ideaSources, permissionKey, () => assertIdeaSource(userId, idea).then(() => undefined))
      comment = row.commentId ? ideaCommentsById.get(row.commentId) ?? null : null
    } else {
      const review = reviewById.get(row.targetId)
      if (!review || review.visibility !== 'shared' || !review.sourceLibraryId || !review.sourceLibraryBookId) continue
      target = review
      permissionKey = `${review.sourceLibraryId}:${review.sourceLibraryBookId}`
      permitted = cachedPermission(context.reviewSources, permissionKey, () => assertSourceWorkReadable(userId, review.sourceLibraryId!, review.sourceLibraryBookId!).then(() => undefined))
      comment = row.commentId ? reviewCommentsById.get(row.commentId) ?? null : null
    }
    if (!await permitted) continue
    if (row.commentId) {
      if (!comment) continue
      const commentTargetId = 'ideaId' in comment ? comment.ideaId : comment.reviewId
      if (commentTargetId !== row.targetId) continue
    }
    if (row.event === 'like') {
      const key = `${row.commentId ?? row.targetId}:${row.actorId}`
      const active = row.commentId
        ? row.domain === 'idea' ? ideaCommentLikeKeys.has(key) : reviewCommentLikeKeys.has(key)
        : row.domain === 'idea' ? ideaLikeKeys.has(key) : reviewLikeKeys.has(key)
      if (!active) continue
    }
    available.push({ row, target, comment })
  }
  return available
}

function project(available: NotificationAvailability, actor: { id: string; username: string; avatarKey: string | null }): InteractionNotification {
  const { row, target, comment } = available
  const preview = comment?.body ?? (row.domain === 'idea'
    ? (target as IdeaRow).note ?? (target as IdeaRow).text
    : reviewExcerpt((target as ReviewRow).body ?? '', (target as ReviewRow).bodyFormat, 180))
  return {
    id: row.id, domain: row.domain, event: row.event, targetId: row.targetId, commentId: row.commentId,
    actor: { id: actor.id, name: actor.username, avatarKey: actor.avatarKey },
    preview: preview.slice(0, 180), createdAt: row.createdAt, readAt: row.readAt,
  }
}

async function* availableNotifications(userId: string, unreadOnly = false) {
  const db = getDb()
  const context: NotificationBatchContext = { ideaSources: new Map(), reviewSources: new Map() }
  for (let offset = 0; ; offset += 50) {
    const rows = db.select().from(interactionNotifications).where(and(
      eq(interactionNotifications.userId, userId), unreadOnly ? isNull(interactionNotifications.readAt) : undefined,
    )).orderBy(desc(interactionNotifications.createdAt), desc(interactionNotifications.id)).limit(50).offset(offset).all()
    for (const entry of await loadNotificationAvailability(userId, rows, context)) yield entry
    if (rows.length < 50) break
  }
}

export async function listNotifications(userId: string, query: NotificationQuery): Promise<NotificationPage> {
  const available: NotificationAvailability[] = []
  let skipped = 0
  for await (const entry of availableNotifications(userId, query.unread)) {
    if (skipped++ < (query.page - 1) * query.pageSize) continue
    available.push(entry)
    if (available.length > query.pageSize) break
  }
  const actorIds = [...new Set(available.map((entry) => entry.row.actorId))]
  const actors = new Map(getDb().select({ id: users.id, username: users.username, avatarKey: users.avatarKey })
    .from(users).where(inArray(users.id, actorIds)).all().map((actor) => [actor.id, actor]))
  const entries = available.flatMap((entry) => {
    const actor = actors.get(entry.row.actorId)
    return actor ? [project(entry, actor)] : []
  })
  return { entries: entries.slice(0, query.pageSize), page: query.page, hasMore: entries.length > query.pageSize }
}

const unreadCountCache = new Map<string, { count: number; at: number; db: ReturnType<typeof getDb>; changes: number }>()
const UNREAD_COUNT_TTL = 15_000

export function invalidateUnreadNotificationCount(userId?: string) {
  if (userId) unreadCountCache.delete(userId)
  else unreadCountCache.clear()
}

export function deleteNotification(userId: string, id: string) {
  invalidateUnreadNotificationCount(userId)
  getDb().delete(interactionNotifications)
    .where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).run()
}

export async function unreadNotificationCount(userId: string) {
  const db = getDb()
  // Target visibility and source permissions can change without notification
  // writes. A connection-local write count covers those paths without coupling
  // every domain service to the notification cache.
  const { changes } = db.get<{ changes: number }>(sql`SELECT total_changes() AS changes`)!
  const cached = unreadCountCache.get(userId)
  const now = Date.now()
  if (cached && cached.db === db && cached.changes === changes && now - cached.at < UNREAD_COUNT_TTL) {
    return { count: cached.count }
  }

  const raw = db.select({ count: sql<number>`count(*)` })
    .from(interactionNotifications)
    .where(and(eq(interactionNotifications.userId, userId), isNull(interactionNotifications.readAt)))
    .get()
  if (!raw || raw.count === 0) {
    unreadCountCache.set(userId, { count: 0, at: now, db, changes })
    return { count: 0 }
  }

  let count = 0
  for await (const _entry of availableNotifications(userId, true)) count += 1
  unreadCountCache.set(userId, { count, at: now, db, changes })
  return { count }
}

export async function notificationTarget(userId: string, id: string): Promise<NotificationTarget> {
  const row = getDb().select().from(interactionNotifications).where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).get()
  if (!row) return { available: false }
  const [entry] = await loadNotificationAvailability(userId, [row], { ideaSources: new Map(), reviewSources: new Map() })
  if (!entry) return { available: false }
  const actor = getDb().select({ id: users.id, username: users.username, avatarKey: users.avatarKey }).from(users).where(eq(users.id, row.actorId)).get()
  return actor ? { available: true, notification: project(entry, actor) } : { available: false }
}

export function markNotificationRead(userId: string, id: string, read: boolean) {
  invalidateUnreadNotificationCount(userId)
  getDb().update(interactionNotifications).set({ readAt: read ? Date.now() : null })
    .where(and(eq(interactionNotifications.id, id), eq(interactionNotifications.userId, userId))).run()
}

export async function markAllNotificationsRead(userId: string) {
  invalidateUnreadNotificationCount(userId)
  const db = getDb()
  let ids: string[] = []
  // Scan all rows: read-state writes must not move the unread offset underneath us.
  for await (const entry of availableNotifications(userId)) {
    if (entry.row.readAt !== null) continue
    ids.push(entry.row.id)
    if (ids.length === 50) {
      db.update(interactionNotifications).set({ readAt: Date.now() }).where(and(eq(interactionNotifications.userId, userId), inArray(interactionNotifications.id, ids))).run()
      ids = []
    }
  }
  if (ids.length) db.update(interactionNotifications).set({ readAt: Date.now() }).where(and(eq(interactionNotifications.userId, userId), inArray(interactionNotifications.id, ids))).run()
}
