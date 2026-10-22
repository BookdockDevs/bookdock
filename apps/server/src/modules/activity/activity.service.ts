import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import type { ActivityEventType, ActivityItem, ActivityPage, ActivityQuery, ManagementActivityItem, ManagementActivityGroupItem } from '@bookdock/shared'
import { reviewExcerpt } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { activityEvents, bookReviews, contentRevisions, ideas, libraryBooks, libraryBookVersions, libraries, readingArchives, users } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { resolveLibraryRelation, assertSharedLibraryVisible, resolveSharedVersionRead } from '../libraries/library-access'
import { sharedVersionAccessConditions } from '../libraries/library-access'
import { getLibrary } from '../libraries/library-access'
import { loadLibraryHiddenTaxonomy, pendingBookDataDeletionVersionIds, workHiddenExclusion, type LibraryHiddenTaxonomy } from '../libraries/library-query'
import { assertIdeaSource } from '../annotations/idea-access'
import { assertSourceWorkReadable } from '../reviews/review-access'
import { getProfileSettings } from '../settings/settings.service'

interface ActivityCursor {
  viewerId: string
  scope: ActivityQuery['scope']
  targetId: string
  type: ActivityQuery['type']
  groupEventId: string | null
  occurredAt: number
  eventId: string
}

const catalogTypes = ['work.added', 'version.added', 'revision.published'] as const
const managementTypes = ['work.trashed', 'work.restored', 'work.deleted', 'version.deleted', 'idea.deleted', 'review.deleted', 'comment.deleted', 'reply.deleted'] as const

type IdeaSourceAccess = Awaited<ReturnType<typeof assertIdeaSource>>
type ReviewSourceAccess = Awaited<ReturnType<typeof assertSourceWorkReadable>>

interface ActivityProjectionContext {
  events: Map<string, typeof activityEvents.$inferSelect>
  actors: Map<string, typeof users.$inferSelect>
  ideas: Map<string, typeof ideas.$inferSelect>
  reviews: Map<string, typeof bookReviews.$inferSelect>
  ideaSources: Map<string, IdeaSourceAccess | null>
  ideaWorks: Map<string, typeof libraryBooks.$inferSelect>
  reviewSources: Map<string, ReviewSourceAccess | null>
  privateWorkTitles: Map<string, string>
  privateVersionTitles: Map<string, string>
  sharedLibraryNames: Map<string, string>
}

function encodeCursor(value: ActivityCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(cursor: string | undefined, identity: Omit<ActivityCursor, 'occurredAt' | 'eventId'>): ActivityCursor | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as ActivityCursor
    if (value.viewerId !== identity.viewerId || value.scope !== identity.scope || value.targetId !== identity.targetId || value.type !== identity.type || value.groupEventId !== identity.groupEventId || !Number.isSafeInteger(value.occurredAt) || typeof value.eventId !== 'string') {
      throw new Error('cursor context mismatch')
    }
    return value
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid activity cursor')
  }
}

function typesForFilter(type: ActivityQuery['type']): ActivityEventType[] | null {
  if (type === 'all') return null
  if (type === 'idea') return ['idea.published']
  if (type === 'review') return ['review.published']
  if (type === 'catalog') return [...catalogTypes]
  return [...managementTypes]
}

function excerpt(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function actorFor(user: typeof users.$inferSelect | undefined, id: string | null) {
  if (!id) return { id: null, name: '系统', avatarKey: null }
  if (!user) return { id: null, name: '账号不可用', avatarKey: null }
  return { id: user.id, name: user.username, avatarKey: user.avatarKey }
}

function ideaSourceKey(libraryId: string | null, listingId: string | null, bookVersionId: string | null) {
  return JSON.stringify([libraryId, listingId, bookVersionId])
}

function reviewSourceKey(libraryId: string | null, workId: string | null) {
  return JSON.stringify([libraryId, workId])
}

function isUnavailableActivitySource(error: unknown) {
  return error instanceof AppError && ['ANNOTATION_NOT_FOUND', 'REVIEW_NOT_FOUND', 'LIBRARY_NOT_FOUND', 'LIBRARY_VERSION_NOT_FOUND', 'FORBIDDEN'].includes(error.code)
}

async function prepareActivityProjectionContext(
  eventRows: Array<typeof activityEvents.$inferSelect>,
  candidates: PersonalActivityCandidate[],
  viewerId: string,
  privateOwnerId: string | null,
): Promise<ActivityProjectionContext> {
  const db = getDb()
  const events = new Map(eventRows.map((row) => [row.id, row]))
  const candidateEventIds = candidates.filter((candidate) => candidate.source === 'event').map((candidate) => candidate.sourceId)
  if (candidateEventIds.length) {
    for (const event of db.select().from(activityEvents).where(inArray(activityEvents.id, candidateEventIds)).all()) events.set(event.id, event)
  }
  const allEvents = [...events.values()]
  const ideaIds = [...new Set([
    ...allEvents.filter((row) => row.eventType === 'idea.published').map((row) => row.targetId),
    ...candidates.filter((candidate) => candidate.source === 'idea').map((candidate) => candidate.sourceId),
  ])]
  const reviewIds = [...new Set([
    ...allEvents.filter((row) => row.eventType === 'review.published').map((row) => row.targetId),
    ...candidates.filter((candidate) => candidate.source === 'review').map((candidate) => candidate.sourceId),
  ])]
  const ideaRows = ideaIds.length ? db.select().from(ideas).where(inArray(ideas.id, ideaIds)).all() : []
  const reviewRows = reviewIds.length ? db.select().from(bookReviews).where(inArray(bookReviews.id, reviewIds)).all() : []
  const ideaMap = new Map(ideaRows.map((row) => [row.id, row]))
  const reviewMap = new Map(reviewRows.map((row) => [row.id, row]))
  const userIds = [...new Set([
    ...allEvents.flatMap((row) => [row.actorUserId, row.snapshotAuthorId]),
    privateOwnerId,
  ].filter((id): id is string => !!id))]
  const actorMap = userIds.length
    ? new Map(db.select().from(users).where(inArray(users.id, userIds)).all().map((user) => [user.id, user]))
    : new Map<string, typeof users.$inferSelect>()
  const ideaSources = new Map<string, IdeaSourceAccess | null>()
  const reviewSources = new Map<string, ReviewSourceAccess | null>()
  for (const event of allEvents) {
    if (event.eventType === 'idea.published') {
      const idea = ideaMap.get(event.targetId)
      if (!idea || idea.userId !== event.actorUserId || idea.visibility !== 'shared' || idea.sharedLibraryId !== event.libraryId || idea.deletedAt) continue
      const key = ideaSourceKey(idea.sharedLibraryId, idea.sourceLibraryBookVersionId, idea.bookVersionId)
      if (ideaSources.has(key)) continue
      try {
        ideaSources.set(key, await assertIdeaSource(viewerId, idea))
      } catch (error) {
        if (!isUnavailableActivitySource(error)) throw error
        ideaSources.set(key, null)
      }
    } else if (event.eventType === 'review.published') {
      const review = reviewMap.get(event.targetId)
      if (!review || review.userId !== event.actorUserId || review.visibility !== 'shared' || review.sourceLibraryId !== event.libraryId || review.sourceLibraryBookId !== event.workId) continue
      const key = reviewSourceKey(review.sourceLibraryId, review.sourceLibraryBookId)
      if (reviewSources.has(key)) continue
      try {
        reviewSources.set(key, await assertSourceWorkReadable(viewerId, review.sourceLibraryId!, review.sourceLibraryBookId!))
      } catch (error) {
        if (!isUnavailableActivitySource(error)) throw error
        reviewSources.set(key, null)
      }
    }
  }
  const ideaWorkIds = [...new Set([...ideaSources.values()].flatMap((source) => source ? [source.link.libraryBookId] : []))]
  const ideaWorkMap = ideaWorkIds.length
    ? new Map(db.select().from(libraryBooks).where(inArray(libraryBooks.id, ideaWorkIds)).all().map((work) => [work.id, work]))
    : new Map<string, typeof libraryBooks.$inferSelect>()
  const privateWorkTitles = new Map<string, string>()
  const privateVersionTitles = new Map<string, string>()
  if (privateOwnerId) {
    const privateIdeas = ideaRows.filter((row) => row.userId === privateOwnerId && row.visibility === 'private' && !row.deletedAt)
    const privateReviews = reviewRows.filter((row) => row.userId === privateOwnerId && row.visibility === 'private')
    const privateWorkIds = [...new Set(privateReviews.flatMap((row) => row.privateLibraryBookId ? [row.privateLibraryBookId] : []))]
    if (privateWorkIds.length) {
      const workRows = db.select({ id: libraryBooks.id, title: libraryBooks.title }).from(libraryBooks)
        .innerJoin(libraries, eq(libraries.id, libraryBooks.libraryId))
        .where(and(inArray(libraryBooks.id, privateWorkIds), eq(libraryBooks.userId, privateOwnerId), eq(libraries.userId, privateOwnerId), eq(libraries.type, 'private'))).all()
      for (const work of workRows) if (work.title) privateWorkTitles.set(work.id, work.title)
    }
    const versionIds = [...new Set([
      ...privateIdeas.flatMap((row) => row.bookVersionId ? [row.bookVersionId] : []),
      ...privateReviews.flatMap((row) => row.readBookVersionId ? [row.readBookVersionId] : []),
    ])]
    if (versionIds.length) {
      const listingRows = db.select({ bookVersionId: libraryBookVersions.bookVersionId, title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})` })
        .from(libraryBookVersions)
        .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
        .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
        .where(and(inArray(libraryBookVersions.bookVersionId, versionIds), eq(libraries.userId, privateOwnerId), eq(libraries.type, 'private'))).all()
      for (const listing of listingRows) if (listing.title && !privateVersionTitles.has(listing.bookVersionId)) privateVersionTitles.set(listing.bookVersionId, listing.title)
      const missingArchiveIds = versionIds.filter((id) => !privateVersionTitles.has(id))
      if (missingArchiveIds.length) {
        const archives = db.select({ bookVersionId: readingArchives.bookVersionId, title: readingArchives.title }).from(readingArchives)
          .where(and(eq(readingArchives.userId, privateOwnerId), inArray(readingArchives.bookVersionId, missingArchiveIds))).all()
        for (const archive of archives) privateVersionTitles.set(archive.bookVersionId, archive.title)
      }
    }
    const sharedLibraryIds = [...new Set([
      ...privateIdeas.flatMap((row) => row.sharedLibraryId ? [row.sharedLibraryId] : []),
      ...privateReviews.flatMap((row) => row.sourceLibraryId ? [row.sourceLibraryId] : []),
    ])]
    const sharedLibraryNames = new Map<string, string>()
    if (sharedLibraryIds.length) {
      const sharedLibs = db.select({ id: libraries.id, name: libraries.name }).from(libraries)
        .where(inArray(libraries.id, sharedLibraryIds)).all()
      for (const lib of sharedLibs) sharedLibraryNames.set(lib.id, lib.name)
    }
    const sharedWorkIds = [...new Set(privateReviews.flatMap((row) => row.sourceLibraryBookId ? [row.sourceLibraryBookId] : []))]
    if (sharedWorkIds.length) {
      const sharedWorks = db.select({ id: libraryBooks.id, title: libraryBooks.title }).from(libraryBooks)
        .where(inArray(libraryBooks.id, sharedWorkIds)).all()
      for (const work of sharedWorks) if (work.title) privateWorkTitles.set(work.id, work.title)
    }
    return { events, actors: actorMap, ideas: ideaMap, reviews: reviewMap, ideaSources, ideaWorks: ideaWorkMap, reviewSources, privateWorkTitles, privateVersionTitles, sharedLibraryNames }
  }
  return { events, actors: actorMap, ideas: ideaMap, reviews: reviewMap, ideaSources, ideaWorks: ideaWorkMap, reviewSources, privateWorkTitles, privateVersionTitles, sharedLibraryNames: new Map<string, string>() }
}

async function projectEvent(row: typeof activityEvents.$inferSelect, viewerId: string, canManage: boolean, context: ActivityProjectionContext): Promise<ActivityItem | null> {
  const db = getDb()
  const actor = row.actorUserId
    ? context.actors.get(row.actorUserId)
    : undefined
  if (row.audience === 'manager') {
    if (!canManage) return null
    return {
      kind: 'management', eventId: row.id, eventType: row.eventType as ManagementActivityItem['eventType'],
      occurredAt: row.occurredAt, actor: actorFor(actor, row.actorUserId), libraryId: row.libraryId,
      operationId: row.operationId,
      target: {
        kind: row.targetKind, id: row.targetId, workId: row.workId, versionId: row.versionId,
        authorId: row.snapshotAuthorId && context.actors.has(row.snapshotAuthorId) ? row.snapshotAuthorId : null,
      },
      content: { workTitle: row.snapshotWorkTitle, objectLabel: row.snapshotObjectLabel },
    } as ActivityItem
  }
  if (row.eventType === 'idea.published') {
    const idea = context.ideas.get(row.targetId)
    if (!idea || idea.userId !== row.actorUserId || idea.visibility !== 'shared' || idea.sharedLibraryId !== row.libraryId || idea.deletedAt) return null
    const source = context?.ideaSources.get(ideaSourceKey(idea.sharedLibraryId, idea.sourceLibraryBookVersionId, idea.bookVersionId))
    const link = source?.link
    if (!link || link.bookVersionId !== row.versionId || link.libraryBookId !== row.workId) return null
    const work = context.ideaWorks.get(link.libraryBookId)
    if (!work || work.libraryId !== row.libraryId) return null
    return {
      kind: 'idea', eventId: row.id, eventType: 'idea.published', occurredAt: row.occurredAt,
      actor: actorFor(actor, row.actorUserId), visibility: 'shared', libraryId: row.libraryId, operationId: row.operationId,
      target: { ideaId: idea.id, libraryBookVersionId: link.id, bookVersionId: link.bookVersionId, revisionId: idea.revisionId },
      content: { workTitle: work.title, libraryName: source?.library.name ?? '', excerpt: excerpt(idea.note || idea.text), chapter: idea.chapter },
    }
  }
  if (row.eventType === 'review.published') {
    const review = context.reviews.get(row.targetId)
    if (!review || review.userId !== row.actorUserId || review.visibility !== 'shared' || review.sourceLibraryId !== row.libraryId || review.sourceLibraryBookId !== row.workId) return null
    const source = context?.reviewSources.get(reviewSourceKey(review.sourceLibraryId, review.sourceLibraryBookId))
    if (!source || source.work.id !== row.workId || source.library.id !== row.libraryId) return null
    return {
      kind: 'review', eventId: row.id, eventType: 'review.published', occurredAt: row.occurredAt,
      actor: actorFor(actor, row.actorUserId), visibility: 'shared', libraryId: row.libraryId, operationId: row.operationId,
      target: { reviewId: review.id, libraryBookId: row.workId ?? '', bookVersionId: review.readBookVersionId },
      content: { workTitle: source.work.title, libraryName: source.library.name, title: review.title, excerpt: review.body ? reviewExcerpt(review.body, review.bodyFormat, 240) : '', ratingHalves: review.ratingHalves },
    }
  }
  if ((catalogTypes as readonly string[]).includes(row.eventType)) {
    if (!row.workId) return null
    const work = db.select().from(libraryBooks).where(and(eq(libraryBooks.id, row.workId), eq(libraryBooks.libraryId, row.libraryId), isNull(libraryBooks.deletedAt))).get()
    if (!work) return null
    let listing: typeof libraryBookVersions.$inferSelect | undefined
    if (row.versionId) {
      try {
        const readable = await resolveSharedVersionRead(row.libraryId, row.versionId, viewerId)
        if (readable.link.libraryBookId !== work.id) return null
        if (row.eventType === 'version.added' && readable.link.id !== row.targetId) return null
        listing = readable.link
      } catch (error) {
        if (!(error instanceof AppError) || !['LIBRARY_NOT_FOUND', 'LIBRARY_VERSION_NOT_FOUND'].includes(error.code)) throw error
        return null
      }
    } else {
      const candidates = db.select().from(libraryBookVersions).where(and(eq(libraryBookVersions.libraryId, row.libraryId), eq(libraryBookVersions.libraryBookId, work.id))).limit(100).all()
      for (const candidate of candidates) {
        try {
          const readable = await resolveSharedVersionRead(row.libraryId, candidate.bookVersionId, viewerId)
          if (readable.link.libraryBookId === work.id) { listing = readable.link; break }
        } catch (error) {
          if (!(error instanceof AppError) || !['LIBRARY_NOT_FOUND', 'LIBRARY_VERSION_NOT_FOUND'].includes(error.code)) throw error
        }
      }
      if (!listing) return null
    }
    let bookVersionId = listing?.bookVersionId ?? null
    let objectLabel: string | null = null
    if (row.eventType === 'revision.published') {
      const revision = db.select().from(contentRevisions).where(eq(contentRevisions.id, row.targetId)).get()
      if (!revision || !listing || revision.bookVersionId !== listing.bookVersionId) return null
      objectLabel = `修订 ${revision.revisionNo}`
    } else objectLabel = listing?.name || null
    const library = db.select().from(libraries).where(eq(libraries.id, row.libraryId)).get()
    if (!library) return null
    return {
      kind: 'catalog', eventId: row.id, eventType: row.eventType as 'work.added' | 'version.added' | 'revision.published',
      occurredAt: row.occurredAt, actor: actorFor(actor, row.actorUserId), libraryId: row.libraryId, operationId: row.operationId,
      target: { workId: work.id, versionId: row.versionId },
      content: { workTitle: work.title, objectLabel, bookVersionId },
    }
  }
  return null
}

interface PersonalActivityCandidate {
  candidateId: string
  source: 'event' | 'idea' | 'review'
  sourceId: string
  occurredAt: number
}

function personalCandidates(userId: string, type: ActivityQuery['type'], includePrivate: boolean, after?: Pick<ActivityCursor, 'occurredAt' | 'eventId'>) {
  const db = getDb()
  const includeIdeas = includePrivate && (type === 'all' || type === 'idea')
  const includeReviews = includePrivate && (type === 'all' || type === 'review')
  const includePublic = type === 'all' || type === 'idea' || type === 'review'
  if (!includePublic && !includeIdeas && !includeReviews) return []
  const candidates = includePublic ? [sql`
    SELECT 'event:' || id AS candidateId, 'event' AS source, id AS sourceId, occurred_at AS occurredAt
    FROM activity_events
    WHERE actor_user_id = ${userId} AND audience = 'library'
      AND event_type IN ('idea.published', 'review.published')
      ${type === 'idea' ? sql`AND event_type = 'idea.published'` : undefined}
      ${type === 'review' ? sql`AND event_type = 'review.published'` : undefined}
  `] : []
  if (includeIdeas) {
    candidates.push(sql`
      SELECT 'private-idea:' || i.id AS candidateId, 'idea' AS source, i.id AS sourceId,
        coalesce((SELECT e.occurred_at FROM activity_events e
          WHERE e.idempotency_key = 'idea.published:' || i.id AND e.event_type = 'idea.published'
            AND e.target_kind = 'idea' AND e.target_id = i.id AND e.actor_user_id = i.user_id
            AND e.audience = 'library' LIMIT 1), i.created_at) AS occurredAt
      FROM ideas i
      WHERE i.user_id = ${userId} AND i.visibility = 'private' AND i.deleted_at IS NULL
    `)
  }
  if (includeReviews) {
    candidates.push(sql`
      SELECT 'private-review:' || r.id AS candidateId, 'review' AS source, r.id AS sourceId,
        coalesce((SELECT e.occurred_at FROM activity_events e
          WHERE e.idempotency_key = 'review.published:' || r.id AND e.event_type = 'review.published'
            AND e.target_kind = 'review' AND e.target_id = r.id AND e.actor_user_id = r.user_id
            AND e.audience = 'library' LIMIT 1), r.created_at) AS occurredAt
      FROM book_reviews r
      WHERE r.user_id = ${userId} AND r.visibility = 'private'
    `)
  }
  const afterClause = after
    ? sql`WHERE occurredAt < ${after.occurredAt} OR (occurredAt = ${after.occurredAt} AND candidateId < ${after.eventId})`
    : sql``
  return db.all<PersonalActivityCandidate>(sql`
    WITH candidates AS (${sql.join(candidates, sql` UNION ALL `)})
    SELECT candidateId, source, sourceId, occurredAt FROM candidates
    ${afterClause}
    ORDER BY occurredAt DESC, candidateId DESC
    LIMIT 100
  `)
}

function pendingPrivateWorkIds(userId: string): Set<string> {
  const db = getDb()
  return new Set(db.select({ id: libraryBooks.id }).from(libraryBooks)
    .innerJoin(libraries, eq(libraries.id, libraryBooks.libraryId))
    .where(and(
      eq(libraryBooks.userId, userId), eq(libraries.userId, userId), eq(libraries.type, 'private'),
      sql`${libraryBooks.deletedAt} IS NOT NULL`,
      sql`json_extract(${libraryBooks.meta}, '$.pendingUserDataDeletion') = 1`,
    )).all().map((row) => row.id))
}

function projectPrivateCandidate(candidate: PersonalActivityCandidate, userId: string, context: ActivityProjectionContext, pendingVersions: Set<string>, pendingWorkIds: Set<string>): ActivityItem | null {
  if (candidate.source === 'idea') {
    const idea = context.ideas.get(candidate.sourceId)
    if (!idea || idea.userId !== userId || idea.visibility !== 'private' || idea.deletedAt || (idea.bookVersionId && pendingVersions.has(idea.bookVersionId))) return null
    const libraryId = idea.sharedLibraryId ?? null
    const libraryName = libraryId ? context.sharedLibraryNames.get(libraryId) ?? null : null
    return {
      kind: 'idea', eventId: candidate.candidateId, eventType: 'idea.recorded', occurredAt: candidate.occurredAt,
      actor: actorFor(context.actors.get(userId), userId), visibility: 'private', libraryId, operationId: null,
      target: { ideaId: idea.id, libraryBookVersionId: null, bookVersionId: idea.bookVersionId, revisionId: idea.revisionId },
      content: { workTitle: idea.bookVersionId ? context.privateVersionTitles.get(idea.bookVersionId) ?? '' : '', libraryName, excerpt: excerpt(idea.note || idea.text), chapter: idea.chapter },
    }
  }
  if (candidate.source === 'review') {
    const review = context.reviews.get(candidate.sourceId)
    if (!review || review.userId !== userId || review.visibility !== 'private' || (review.readBookVersionId && pendingVersions.has(review.readBookVersionId)) || (review.privateLibraryBookId && pendingWorkIds.has(review.privateLibraryBookId))) return null
    const libraryId = review.sourceLibraryId ?? null
    const libraryName = libraryId ? context.sharedLibraryNames.get(libraryId) ?? null : null
    return {
      kind: 'review', eventId: candidate.candidateId, eventType: 'review.recorded', occurredAt: candidate.occurredAt,
      actor: actorFor(context.actors.get(userId), userId), visibility: 'private', libraryId, operationId: null,
      target: { reviewId: review.id, libraryBookId: review.sourceLibraryBookId ?? null, bookVersionId: review.readBookVersionId },
      content: {
        workTitle: (review.privateLibraryBookId ? context.privateWorkTitles.get(review.privateLibraryBookId) : undefined)
          ?? (review.sourceLibraryBookId ? context.privateWorkTitles.get(review.sourceLibraryBookId) : undefined)
          ?? (review.readBookVersionId ? context.privateVersionTitles.get(review.readBookVersionId) : undefined) ?? '',
        libraryName,
        title: review.title, excerpt: review.body ? reviewExcerpt(review.body, review.bodyFormat, 240) : '', ratingHalves: review.ratingHalves,
      },
    }
  }
  return null
}

async function listPersonalActivity(viewerId: string, targetId: string, query: ActivityQuery): Promise<ActivityPage> {
  const db = getDb()
  const cursorIdentity = { viewerId, scope: query.scope, targetId, type: query.type, groupEventId: null }
  const cursor = decodeCursor(query.cursor, cursorIdentity)
  const ownFeed = targetId === viewerId
  if (query.type === 'catalog' || query.type === 'management') return { items: [], nextCursor: null, canManage: false }
  const pendingVersions = new Set(ownFeed ? pendingBookDataDeletionVersionIds(db, viewerId) : [])
  const pendingWorkIds = ownFeed ? pendingPrivateWorkIds(viewerId) : new Set<string>()
  const items: ActivityItem[] = []
  let scan: Pick<ActivityCursor, 'occurredAt' | 'eventId'> | undefined = cursor ? { occurredAt: cursor.occurredAt, eventId: cursor.eventId } : undefined
  let hasMore = false
  while (!hasMore) {
    const rows = personalCandidates(targetId, query.type, ownFeed, scan)
    if (!rows.length) break
    const context = await prepareActivityProjectionContext([], rows, viewerId, ownFeed ? targetId : null)
    for (const row of rows) {
      const previous = scan
      scan = { occurredAt: row.occurredAt, eventId: row.candidateId }
      let projected: ActivityItem | null = null
      if (row.source === 'event') {
        const event = context.events.get(row.sourceId)
        if (event) {
          try {
            projected = await projectEvent(event, viewerId, false, context)
          } catch (error) {
            if (!isUnavailableActivitySource(error)) throw error
          }
        }
      } else if (ownFeed) {
        projected = projectPrivateCandidate(row, targetId, context, pendingVersions, pendingWorkIds)
      }
      if (!projected) continue
      items.push(projected)
      if (items.length > query.limit) {
        hasMore = true
        scan = previous
        break
      }
    }
    if (rows.length < 100 || hasMore) break
  }
  const nextCursor = hasMore && scan
    ? encodeCursor({ ...cursorIdentity, occurredAt: scan.occurredAt, eventId: scan.eventId })
    : null
  return { items: items.slice(0, query.limit), nextCursor, canManage: false }
}

export async function listActivity(viewerId: string, query: ActivityQuery): Promise<ActivityPage> {
  const db = getDb()
  const targetId = query.scope === 'personal' ? (query.userId ?? viewerId) : query.libraryId!
  let canManage = false
  if (query.scope === 'personal') {
    if (targetId !== viewerId) {
      if (!db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).get()) throw new AppError('USER_NOT_FOUND')
      const profile = getProfileSettings(targetId)
      if (profile.isPublic === false || profile.showPublicActivity !== true) throw new AppError('USER_NOT_FOUND')
    }
  } else {
    const library = await getLibrary(targetId)
    if (library.type !== 'shared') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
    const relation = await resolveLibraryRelation(targetId, { userId: viewerId })
    assertSharedLibraryVisible(library, relation)
    canManage = relation === 'owner' || relation === 'admin'
  }
  if (query.scope === 'personal') return listPersonalActivity(viewerId, targetId, query)
  if (query.groupEventId) return listOperationChildren(viewerId, query, targetId, canManage)

  const cursorIdentity = { viewerId, scope: query.scope, targetId, type: query.type, groupEventId: null }
  const cursor = decodeCursor(query.cursor, cursorIdentity)
  const allowedTypes = typesForFilter(query.type)
  const entries: ActivityItem[] = []
  let scanAt = cursor?.occurredAt
  let scanId = cursor?.eventId
  let hasMore = false
  while (!hasMore) {
    const where = and(
      eq(activityEvents.libraryId, targetId),
      canManage ? undefined : eq(activityEvents.audience, 'library'),
      allowedTypes?.length ? sql`${activityEvents.eventType} IN (${sql.join(allowedTypes.map((item) => sql`${item}`), sql`, `)})` : undefined,
      sql`NOT (
        ${activityEvents.operationId} IS NOT NULL
        AND ${activityEvents.eventType} IN ('work.added','version.added','revision.published','work.trashed','work.restored','work.deleted','version.deleted','idea.deleted','review.deleted','comment.deleted','reply.deleted')
        AND EXISTS (
          SELECT 1 FROM activity_events newer
          WHERE newer.library_id = ${activityEvents.libraryId}
            AND newer.audience = ${activityEvents.audience}
            AND newer.actor_user_id IS ${activityEvents.actorUserId}
            AND newer.operation_id = ${activityEvents.operationId}
            AND newer.event_type = ${activityEvents.eventType}
            AND (newer.occurred_at > ${activityEvents.occurredAt} OR (newer.occurred_at = ${activityEvents.occurredAt} AND newer.id > ${activityEvents.id}))
        )
      )`,
      scanAt !== undefined && scanId ? or(lt(activityEvents.occurredAt, scanAt), and(eq(activityEvents.occurredAt, scanAt), lt(activityEvents.id, scanId))) : undefined,
    )
    const rows = db.select().from(activityEvents).where(where).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(100).all()
    if (rows.length === 0) break
    const context = await prepareActivityProjectionContext(rows, [], viewerId, null)
    for (const row of rows) {
      const previous = { occurredAt: scanAt, eventId: scanId }
      scanAt = row.occurredAt
      scanId = row.id
      const canGroup = !!row.operationId && (catalogTypes.includes(row.eventType as typeof catalogTypes[number]) || managementTypes.includes(row.eventType as typeof managementTypes[number]))
      if (canGroup) {
        const group = await projectOperationGroup(viewerId, row, canManage)
        if (!group) continue
        entries.push(group)
        if (entries.length > query.limit) {
          hasMore = true
          scanAt = previous.occurredAt
          scanId = previous.eventId
          break
        }
        continue
      }
      let projected: ActivityItem | null = null
      try {
        projected = await projectEvent(row, viewerId, canManage, context)
      } catch (error) {
        if (!isUnavailableActivitySource(error)) throw error
      }
      if (!projected) continue
      entries.push(projected)
      if (entries.length > query.limit) {
        hasMore = true
        scanAt = previous.occurredAt
        scanId = previous.eventId
        break
      }
    }
    if (rows.length < 100 || hasMore) break
  }
  const pageItems = entries.slice(0, query.limit)
  const nextCursor = hasMore && scanAt !== undefined && scanId
    ? encodeCursor({ ...cursorIdentity, occurredAt: scanAt, eventId: scanId })
    : null
  return { items: pageItems, nextCursor, canManage }
}

function operationPredicate(head: typeof activityEvents.$inferSelect) {
  return and(
    eq(activityEvents.libraryId, head.libraryId), head.actorUserId ? eq(activityEvents.actorUserId, head.actorUserId) : isNull(activityEvents.actorUserId),
    eq(activityEvents.operationId, head.operationId!), eq(activityEvents.eventType, head.eventType), eq(activityEvents.audience, head.audience),
  )
}

function catalogBatchConditions(
  viewerId: string,
  canManage: boolean,
  head: typeof activityEvents.$inferSelect,
  taxonomy?: LibraryHiddenTaxonomy,
) {
  const currentTaxonomy = canManage ? undefined : (taxonomy ?? loadLibraryHiddenTaxonomy(getDb(), head.libraryId))
  return {
    taxonomy,
    access: and(
      isNull(libraryBooks.deletedAt),
      head.eventType === 'version.added' ? eq(libraryBookVersions.id, activityEvents.targetId) : undefined,
      !canManage ? and(
        eq(libraryBookVersions.status, 'published'),
        sharedVersionAccessConditions(viewerId),
        workHiddenExclusion(currentTaxonomy!),
      ) : undefined,
      head.eventType === 'revision.published' ? sql`${contentRevisions.id} IS NOT NULL` : undefined,
    ),
  }
}

function queryReadableCatalogRows(
  viewerId: string,
  canManage: boolean,
  head: typeof activityEvents.$inferSelect,
  eventIds?: string[],
  taxonomy?: LibraryHiddenTaxonomy,
) {
  const db = getDb()
  const { access } = catalogBatchConditions(viewerId, canManage, head, taxonomy)
  const linkMatch = and(
    eq(libraryBookVersions.libraryId, activityEvents.libraryId),
    eq(libraryBookVersions.libraryBookId, activityEvents.workId),
    or(isNull(activityEvents.versionId), eq(libraryBookVersions.bookVersionId, activityEvents.versionId)),
  )
  return db.selectDistinct({
    event: activityEvents,
    workTitle: libraryBooks.title,
    libraryName: libraries.name,
    listing: libraryBookVersions,
    revisionNo: contentRevisions.revisionNo,
  }).from(activityEvents)
    .innerJoin(libraries, eq(libraries.id, activityEvents.libraryId))
    .innerJoin(libraryBooks, and(eq(libraryBooks.id, activityEvents.workId), eq(libraryBooks.libraryId, activityEvents.libraryId)))
    .innerJoin(libraryBookVersions, linkMatch)
    .leftJoin(contentRevisions, and(eq(contentRevisions.id, activityEvents.targetId), eq(contentRevisions.bookVersionId, activityEvents.versionId)))
    .where(and(operationPredicate(head), access, eventIds?.length ? inArray(activityEvents.id, eventIds) : undefined))
    .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id), libraryBookVersions.createdAt, libraryBookVersions.id)
}

function loadUsersByIds(ids: Array<string | null>) {
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (!uniqueIds.length) return new Map<string, typeof users.$inferSelect>()
  const rows = getDb().select().from(users).where(inArray(users.id, uniqueIds)).all()
  return new Map(rows.map((user) => [user.id, user]))
}

async function projectOperationGroup(viewerId: string, head: typeof activityEvents.$inferSelect, canManage: boolean): Promise<ActivityItem | null> {
  const db = getDb()
  if (!head.operationId) return null
  let count: number
  let visibleHead: typeof activityEvents.$inferSelect | null
  let preview: ManagementActivityGroupItem['preview'] | Array<{ workId: string; versionId: string | null; workTitle: string; objectLabel: string | null; bookVersionId: string | null }>
  if (head.audience === 'manager') {
    if (!canManage) return null
    count = db.select({ value: sql<number>`count(*)` }).from(activityEvents).where(operationPredicate(head)).get()?.value ?? 0
    const rows = db.select().from(activityEvents).where(operationPredicate(head))
      .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(5).all()
    if (!rows.length) return null
    visibleHead = rows[0]
    preview = rows.map((row) => ({ targetKind: row.targetKind, targetId: row.targetId, workTitle: row.snapshotWorkTitle, objectLabel: row.snapshotObjectLabel }))
  } else {
    if (head.audience !== 'library') return null
    const taxonomy = canManage ? undefined : loadLibraryHiddenTaxonomy(db, head.libraryId)
    const conditions = catalogBatchConditions(viewerId, canManage, head, taxonomy)
    const countRow = db.select({ value: sql<number>`count(distinct ${activityEvents.id})` }).from(activityEvents)
      .innerJoin(libraries, eq(libraries.id, activityEvents.libraryId))
      .innerJoin(libraryBooks, and(eq(libraryBooks.id, activityEvents.workId), eq(libraryBooks.libraryId, activityEvents.libraryId)))
      .innerJoin(libraryBookVersions, and(
        eq(libraryBookVersions.libraryId, activityEvents.libraryId),
        eq(libraryBookVersions.libraryBookId, activityEvents.workId),
        or(isNull(activityEvents.versionId), eq(libraryBookVersions.bookVersionId, activityEvents.versionId)),
      ))
      .leftJoin(contentRevisions, and(eq(contentRevisions.id, activityEvents.targetId), eq(contentRevisions.bookVersionId, activityEvents.versionId)))
      .where(and(operationPredicate(head), conditions.access)).get()
    count = countRow?.value ?? 0
    const rows = queryReadableCatalogRows(viewerId, canManage, head, undefined, taxonomy).limit(5).all()
    if (!rows.length) return null
    visibleHead = rows[0].event
    const seen = new Set<string>()
    preview = rows.flatMap((row) => {
      if (seen.has(row.event.id)) return []
      seen.add(row.event.id)
      return [{
        workId: row.event.workId!, versionId: row.event.versionId, workTitle: row.workTitle,
        objectLabel: row.event.eventType === 'revision.published' && row.revisionNo !== null ? `修订 ${row.revisionNo}` : row.listing.name || null,
        bookVersionId: row.listing.bookVersionId,
      }]
    })
  }
  if (!count || !visibleHead) return null
  const actor = visibleHead.actorUserId ? loadUsersByIds([visibleHead.actorUserId]).get(visibleHead.actorUserId) : undefined
  const base = { eventId: visibleHead.id, eventType: visibleHead.eventType, occurredAt: visibleHead.occurredAt, actor: actorFor(actor, visibleHead.actorUserId), libraryId: visibleHead.libraryId, operationId: head.operationId }
  if (head.audience === 'manager') {
    return { kind: 'management-group', ...base, eventType: head.eventType as ManagementActivityItem['eventType'], count, preview: preview as ManagementActivityGroupItem['preview'] }
  }
  return { kind: 'catalog-group', ...base, eventType: head.eventType as 'work.added' | 'version.added' | 'revision.published', count, preview: preview as Array<{ workId: string; versionId: string | null; workTitle: string; objectLabel: string | null; bookVersionId: string | null }> }
}

function projectGroupChildren(
  rows: Array<typeof activityEvents.$inferSelect>,
  viewerId: string,
  head: typeof activityEvents.$inferSelect,
  canManage: boolean,
  taxonomy?: LibraryHiddenTaxonomy,
): Map<string, ActivityItem> {
  const projected = new Map<string, ActivityItem>()
  if (head.audience === 'manager') {
    if (!canManage) return projected
    const userMap = loadUsersByIds(rows.flatMap((row) => [row.actorUserId, row.snapshotAuthorId]))
    for (const row of rows) {
      projected.set(row.id, {
        kind: 'management', eventId: row.id, eventType: row.eventType as ManagementActivityItem['eventType'],
        occurredAt: row.occurredAt, actor: actorFor(userMap.get(row.actorUserId ?? ''), row.actorUserId), libraryId: row.libraryId,
        operationId: row.operationId,
        target: {
          kind: row.targetKind, id: row.targetId, workId: row.workId, versionId: row.versionId,
          authorId: row.snapshotAuthorId && userMap.has(row.snapshotAuthorId) ? row.snapshotAuthorId : null,
        },
        content: { workTitle: row.snapshotWorkTitle, objectLabel: row.snapshotObjectLabel },
      } as ActivityItem)
    }
    return projected
  }
  if (head.audience !== 'library' || !rows.length) return projected
  const readableRows = queryReadableCatalogRows(viewerId, canManage, head, rows.map((row) => row.id), taxonomy).all()
  const visibleEvents = new Map<string, (typeof readableRows)[number]>()
  for (const item of readableRows) {
    if (!visibleEvents.has(item.event.id)) visibleEvents.set(item.event.id, item)
  }
  const actorMap = loadUsersByIds([...visibleEvents.values()].map((item) => item.event.actorUserId))
  for (const row of rows) {
    const item = visibleEvents.get(row.id)
    if (!item) continue
    projected.set(row.id, {
      kind: 'catalog', eventId: item.event.id, eventType: item.event.eventType as 'work.added' | 'version.added' | 'revision.published',
      occurredAt: item.event.occurredAt, actor: actorFor(actorMap.get(item.event.actorUserId ?? ''), item.event.actorUserId),
      libraryId: item.event.libraryId, operationId: item.event.operationId,
      target: { workId: item.event.workId!, versionId: item.event.versionId },
      content: {
        workTitle: item.workTitle,
        objectLabel: item.event.eventType === 'revision.published' && item.revisionNo !== null ? `修订 ${item.revisionNo}` : item.listing.name || null,
        bookVersionId: item.listing.bookVersionId,
      },
    })
  }
  return projected
}

async function listOperationChildren(viewerId: string, query: ActivityQuery, libraryId: string, canManage: boolean): Promise<ActivityPage> {
  if (query.scope !== 'library') throw new AppError('VALIDATION_ERROR')
  const db = getDb()
  const head = db.select().from(activityEvents).where(and(eq(activityEvents.id, query.groupEventId!), eq(activityEvents.libraryId, libraryId))).get()
  const isCatalogGroup = !!head?.operationId && catalogTypes.includes(head.eventType as typeof catalogTypes[number]) && head.audience === 'library'
  const isManagerGroup = !!head?.operationId && managementTypes.includes(head.eventType as typeof managementTypes[number]) && head.audience === 'manager' && canManage
  if (!head?.operationId || (!isCatalogGroup && !isManagerGroup)) throw new AppError('ACTIVITY_NOT_FOUND')
  const cursorIdentity = { viewerId, scope: query.scope, targetId: libraryId, type: query.type, groupEventId: head.id }
  const cursor = decodeCursor(query.cursor, cursorIdentity)
  const sameOperation = and(
    eq(activityEvents.libraryId, head.libraryId), head.actorUserId ? eq(activityEvents.actorUserId, head.actorUserId) : isNull(activityEvents.actorUserId),
    eq(activityEvents.operationId, head.operationId), eq(activityEvents.eventType, head.eventType), eq(activityEvents.audience, head.audience),
  )
  const items: ActivityItem[] = []
  const taxonomy = isCatalogGroup && !canManage ? loadLibraryHiddenTaxonomy(db, libraryId) : undefined
  let nextCursor: string | null = null
  let scanAt = cursor?.occurredAt
  let scanId = cursor?.eventId
  let done = false
  while (!done) {
    const rows = db.select().from(activityEvents).where(and(sameOperation,
      scanAt !== undefined && scanId ? or(lt(activityEvents.occurredAt, scanAt), and(eq(activityEvents.occurredAt, scanAt), lt(activityEvents.id, scanId))) : undefined,
    )).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id)).limit(100).all()
    if (!rows.length) break
    const batch = projectGroupChildren(rows, viewerId, head, canManage, taxonomy)
    for (const row of rows) {
      const previous = { occurredAt: scanAt, eventId: scanId }
      scanAt = row.occurredAt
      scanId = row.id
      const item = batch.get(row.id) ?? null
      if (!item) continue
      if (items.length === query.limit) {
        nextCursor = previous.occurredAt !== undefined && previous.eventId
          ? encodeCursor({ ...cursorIdentity, occurredAt: previous.occurredAt, eventId: previous.eventId })
          : null
        done = true
        break
      }
      items.push(item)
    }
    if (rows.length < 100 || done) break
  }
  return { items, nextCursor, canManage, groupEventId: head.id }
}
