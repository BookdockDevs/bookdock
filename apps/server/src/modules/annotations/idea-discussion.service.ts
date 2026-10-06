import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'

import type { IdeaAuthor, IdeaComment, IdeaDiscussion, ReaderIdea } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { ideaCommentLikes, ideaComments, ideaLikes, ideas, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { assertIdeaSource, readableIdea } from './idea-access'
import { toRes } from './annotations.service'

function author(userId: string | null): IdeaAuthor {
  if (!userId) return { id: '', name: 'Deleted user', avatarKey: null }
  const user = getDb().select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { id: userId, name: 'Deleted user', avatarKey: null }
  return { id: user.id, name: user.username, avatarKey: user.avatarKey }
}

function projectIdea(userId: string | null, row: typeof ideas.$inferSelect, manager: boolean, revisionId?: string): ReaderIdea {
  const db = getDb()
  const likes = db.select().from(ideaLikes).where(eq(ideaLikes.ideaId, row.id)).all()
  const comments = db.select({ id: ideaComments.id }).from(ideaComments).where(and(eq(ideaComments.ideaId, row.id), isNull(ideaComments.deletedAt))).all()
  return {
    annotation: toRes('idea', row), author: author(row.userId), own: row.userId === userId,
    canDelete: row.userId === userId || manager, likeCount: likes.length, liked: likes.some((like) => like.userId === userId),
    commentCount: comments.length,
    // Missing CFI is the only hard failure. A null row/contra revision means
    // legacy or unknown provenance, which falls back to CFI resolution.
    locationAvailable: !row.cfiRange ? false : !row.revisionId || !revisionId ? true : row.revisionId === revisionId,
  }
}

export async function listReaderIdeas(userId: string | null, source: { libraryId: string; listingId: string; bookId: string; revisionId: string }) {
  const read = await assertIdeaSource(userId, { sharedLibraryId: source.libraryId, sourceLibraryBookVersionId: source.listingId, bookVersionId: source.bookId })
  const rows = getDb().select().from(ideas).where(and(
    eq(ideas.sharedLibraryId, source.libraryId), eq(ideas.sourceLibraryBookVersionId, source.listingId),
    eq(ideas.bookVersionId, source.bookId),
    userId ? or(eq(ideas.visibility, 'shared'), eq(ideas.userId, userId)) : eq(ideas.visibility, 'shared'),
    isNull(ideas.deletedAt),
  )).orderBy(asc(ideas.createdAt), asc(ideas.id)).all()
  return rows.map((row) => projectIdea(userId, row, read.relation === 'owner' || read.relation === 'admin', source.revisionId))
}

export async function getIdeaDiscussion(userId: string | null, ideaId: string, revisionId?: string): Promise<IdeaDiscussion> {
  const { row, manager } = await readableIdea(userId, ideaId)
  const db = getDb()
  const rows = db.select().from(ideaComments).where(eq(ideaComments.ideaId, row.id)).orderBy(asc(ideaComments.createdAt), asc(sql`rowid`)).all()
  const comments: IdeaComment[] = rows.map((comment) => {
    const likes = db.select().from(ideaCommentLikes).where(eq(ideaCommentLikes.commentId, comment.id)).all()
    const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
    return {
      id: comment.id, parentId: comment.parentId, replyToId: comment.replyToId,
      replyToName: replyTo ? author(replyTo.userId).name : null, author: author(comment.userId),
      body: comment.deletedAt ? null : comment.body, createdAt: comment.createdAt, editedAt: comment.editedAt, deletedAt: comment.deletedAt,
      own: userId === comment.userId, canDelete: userId === comment.userId || manager,
      liked: likes.some((like) => like.userId === userId), likeCount: likes.length,
    }
  })
  const likers = db.select().from(ideaLikes).where(eq(ideaLikes.ideaId, row.id)).orderBy(asc(ideaLikes.createdAt), asc(ideaLikes.userId)).all().map((like) => author(like.userId))
  return { idea: projectIdea(userId, row, manager, revisionId), comments, likers }
}

export async function commentLikers(userId: string | null, ideaId: string, commentId: string) {
  await readableIdea(userId, ideaId)
  const db = getDb()
  const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get()
  if (!comment) throw new AppError('ANNOTATION_NOT_FOUND')
  return db.select().from(ideaCommentLikes).where(eq(ideaCommentLikes.commentId, commentId)).orderBy(asc(ideaCommentLikes.createdAt), asc(ideaCommentLikes.userId)).all().map((like) => author(like.userId))
}

export async function createIdeaComment(userId: string, ideaId: string, input: { body: string; replyToId?: string }) {
  await readableIdea(userId, ideaId)
  const db = getDb()
  const replyTo = input.replyToId ? db.select().from(ideaComments).where(and(eq(ideaComments.id, input.replyToId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get() : null
  if (input.replyToId && !replyTo) throw new AppError('ANNOTATION_NOT_FOUND')
  const comment = { id: createId('ic'), ideaId, userId, parentId: replyTo ? replyTo.parentId ?? replyTo.id : null, replyToId: replyTo?.id ?? null, body: input.body, createdAt: Date.now() }
  db.insert(ideaComments).values(comment).run()
  return comment.id
}

export async function updateIdeaComment(userId: string, ideaId: string, commentId: string, body: string) {
  await readableIdea(userId, ideaId)
  const db = getDb()
  const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), eq(ideaComments.userId, userId), isNull(ideaComments.deletedAt))).get()
  if (!comment) throw new AppError('ANNOTATION_NOT_FOUND')
  if (comment.body !== body) db.update(ideaComments).set({ body, editedAt: Date.now() }).where(eq(ideaComments.id, commentId)).run()
}

export async function deleteIdeaComment(userId: string, ideaId: string, commentId: string) {
  const { manager } = await readableIdea(userId, ideaId)
  const db = getDb()
  const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get()
  if (!comment || (comment.userId !== userId && !manager)) throw new AppError('ANNOTATION_NOT_FOUND')
  db.transaction((tx) => {
    tx.delete(ideaCommentLikes).where(eq(ideaCommentLikes.commentId, commentId)).run()
    // No tombstones: surviving replies are promoted to top level so the thread
    // stays readable with no "deleted" scar. replyTo references null out via
    // FK, and children are updated before the delete to avoid the cascade.
    tx.update(ideaComments).set({ parentId: null }).where(eq(ideaComments.parentId, commentId)).run()
    tx.delete(ideaComments).where(eq(ideaComments.id, commentId)).run()
  })
}

export async function setIdeaLike(userId: string, ideaId: string, liked: boolean, commentId?: string) {
  await readableIdea(userId, ideaId)
  const db = getDb()
  if (commentId) {
    const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get()
    if (!comment) throw new AppError('ANNOTATION_NOT_FOUND')
    if (liked) db.insert(ideaCommentLikes).values({ commentId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
    else db.delete(ideaCommentLikes).where(and(eq(ideaCommentLikes.commentId, commentId), eq(ideaCommentLikes.userId, userId))).run()
  } else if (liked) db.insert(ideaLikes).values({ ideaId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
  else db.delete(ideaLikes).where(and(eq(ideaLikes.ideaId, ideaId), eq(ideaLikes.userId, userId))).run()
}
