import { and, desc, eq, isNull } from 'drizzle-orm'

import type { BookShareDuration, BookShareLink } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookShareLinks, bookVersions, contentRevisions, libraries, libraryBooks, libraryBookVersions, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { decryptPassword, encryptPassword } from '../../lib/secrets'
import { generateSessionToken, hashAccessToken } from '../../lib/token'
import { AppError } from '../../middleware/error'
import { requireLibraryManager } from '../libraries/library-access'

const durationHours: Record<Exclude<BookShareDuration, 'permanent'>, number> = { '1h': 1, '1d': 24, '7d': 168, '30d': 720 }

function findShareSource(userId: string, versionId: string, opts: { libraryId?: string; sourceId?: string }) {
  const db = getDb()
  const user = db.select({ disabled: users.disabled }).from(users).where(eq(users.id, userId)).get()
  if (!user || user.disabled) return null

  const sources = db.select({
    id: libraryBookVersions.id,
    libraryId: libraries.id,
    libraryType: libraries.type,
    libraryOwnerId: libraries.userId,
    kind: libraryBookVersions.kind,
    title: libraryBookVersions.title,
    workTitle: libraryBooks.title,
    format: bookVersions.format,
  }).from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .innerJoin(bookVersions, eq(bookVersions.id, libraryBookVersions.bookVersionId))
    .where(and(
      eq(libraryBookVersions.bookVersionId, versionId),
      isNull(libraryBooks.deletedAt),
      opts.libraryId ? eq(libraries.id, opts.libraryId) : undefined,
      opts.sourceId ? eq(libraryBookVersions.id, opts.sourceId) : undefined,
    ))
    .orderBy(libraries.type, libraryBookVersions.id).all()

  const source = sources.find((candidate) => {
    if (candidate.libraryType === 'private') {
      return candidate.libraryOwnerId === userId && candidate.kind !== 'shared'
    }
    try {
      requireLibraryManager(userId, candidate.libraryId)
      return true
    } catch (err) {
      if (err instanceof AppError && (err.code === 'FORBIDDEN' || err.code === 'LIBRARY_NOT_FOUND')) return false
      throw err
    }
  })
  if (!source) return null

  const revision = db.select({ id: contentRevisions.id, filePath: contentRevisions.blobKey })
    .from(contentRevisions).where(eq(contentRevisions.bookVersionId, versionId))
    .orderBy(desc(contentRevisions.revisionNo)).get()
  if (!revision) return null
  return { sourceId: source.id, title: source.title ?? source.workTitle, format: source.format, revisionId: revision.id, filePath: revision.filePath }
}

export function manageBookShare(
  userId: string,
  versionId: string,
  libraryId: string | undefined,
  action: { type: 'read' | 'revoke' } | { type: 'generate' | 'get-or-create'; duration: BookShareDuration },
): BookShareLink | null {
  const db = getDb()
  return db.transaction((tx) => {
    const source = findShareSource(userId, versionId, { libraryId })
    if (!source) throw new AppError('BOOK_NOT_FOUND', 'Book is unavailable for sharing')
    const where = and(eq(bookShareLinks.sourceId, source.sourceId), eq(bookShareLinks.userId, userId))
    if (action.type === 'revoke') {
      tx.delete(bookShareLinks).where(where).run()
      return null
    }
    const existing = tx.select().from(bookShareLinks).where(where).get()
    const now = Date.now()
    if (action.type !== 'generate' && existing && existing.revisionId === source.revisionId
      && (existing.expiresAt === null || existing.expiresAt > now)) {
      const token = decryptPassword(existing.encryptedToken)
      if (token) return { url: `/api/v1/book-shares/download/${token}`, duration: existing.duration, expiresAt: existing.expiresAt }
    }
    if (!('duration' in action)) return null

    const { duration } = action
    const token = `bd_sh_${generateSessionToken()}`
    const expiresAt = duration === 'permanent' ? null : now + durationHours[duration] * 3_600_000
    const values = { revisionId: source.revisionId, encryptedToken: encryptPassword(token), tokenHash: hashAccessToken(token), duration, expiresAt }
    tx.insert(bookShareLinks).values({ id: createId(), userId, sourceId: source.sourceId, ...values })
      .onConflictDoUpdate({ target: [bookShareLinks.sourceId, bookShareLinks.userId], set: values }).run()
    return { url: `/api/v1/book-shares/download/${token}`, duration, expiresAt }
  }, { behavior: 'immediate' })
}

export function resolveBookShare(token: string) {
  const db = getDb()
  const row = db.select({
    userId: bookShareLinks.userId,
    sourceId: bookShareLinks.sourceId,
    revisionId: bookShareLinks.revisionId,
    expiresAt: bookShareLinks.expiresAt,
    versionId: libraryBookVersions.bookVersionId,
  }).from(bookShareLinks).innerJoin(libraryBookVersions, eq(libraryBookVersions.id, bookShareLinks.sourceId))
    .where(eq(bookShareLinks.tokenHash, hashAccessToken(token))).get()
  if (!row || (row.expiresAt !== null && row.expiresAt <= Date.now())) return null
  const source = findShareSource(row.userId, row.versionId, { sourceId: row.sourceId })
  return source?.revisionId === row.revisionId ? source : null
}
