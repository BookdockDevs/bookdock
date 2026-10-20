import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import type { IdeaAuthor, IdeaComment, IdeaDiscussion, ReaderIdea } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { ideaCommentLikes, ideaComments, ideaLikes, ideas, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { findCommentReceipt, recordInteractionNotification, saveCommentReceipt } from '../../lib/interaction-notifications'
import { AppError } from '../../middleware/error'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { assertReadableBook } from '../books/books.service'
import { assertIdeaSource, readableIdea } from './idea-access'
import { toRes } from './annotations.service'

export async function listReaderIdeas(userId: string | null, source: { libraryId: string; listingId: string; bookId: string; revisionId: string }) {
  const read = await assertIdeaSource(userId, { sharedLibraryId: source.libraryId, sourceLibraryBookVersionId: source.listingId, bookVersionId: source.bookId })
  const rows = getDb().select().from(ideas).where(and(
    eq(ideas.sharedLibraryId, source.libraryId), eq(ideas.sourceLibraryBookVersionId, source.listingId),
    eq(ideas.bookVersionId, source.bookId),
    userId ? or(eq(ideas.visibility, 'shared'), eq(ideas.userId, userId)) : eq(ideas.visibility, 'shared'),
    isNull(ideas.deletedAt),
  )).orderBy(asc(ideas.createdAt), asc(ideas.id)).all()

  if (rows.length === 0) return []
  const db = getDb()
  const ideaIds = rows.map((r) => r.id)
  const manager = read.relation === 'owner' || read.relation === 'admin'

  const likesByIdea = new Map<string, Array<{ userId: string }>>()
  for (const like of db.select({ ideaId: ideaLikes.ideaId, userId: ideaLikes.userId }).from(ideaLikes).where(inArray(ideaLikes.ideaId, ideaIds)).all()) {
    const list = likesByIdea.get(like.ideaId) ?? []
    list.push(like)
    likesByIdea.set(like.ideaId, list)
  }

  const commentCountByIdea = new Map<string, number>()
  for (const comment of db.select({ ideaId: ideaComments.ideaId }).from(ideaComments).where(and(inArray(ideaComments.ideaId, ideaIds), isNull(ideaComments.deletedAt))).all()) {
    commentCountByIdea.set(comment.ideaId, (commentCountByIdea.get(comment.ideaId) ?? 0) + 1)
  }

  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[]
  const authorsById = new Map<string, IdeaAuthor>()
  if (userIds.length > 0) {
    for (const u of db.select({ id: users.id, name: users.username, avatarKey: users.avatarKey }).from(users).where(inArray(users.id, userIds)).all()) {
      authorsById.set(u.id, u)
    }
  }
  const resolveAuthor = (authorId: string | null): IdeaAuthor => {
    if (!authorId) return { id: '', name: 'Deleted user', avatarKey: null }
    return authorsById.get(authorId) ?? { id: authorId, name: 'Deleted user', avatarKey: null }
  }

  return rows.map((row) => {
    const likes = likesByIdea.get(row.id) ?? []
    return {
      annotation: toRes('idea', row),
      author: resolveAuthor(row.userId),
      own: row.userId === userId,
      canDelete: row.userId === userId || manager,
      likeCount: likes.length,
      liked: likes.some((like) => like.userId === userId),
      commentCount: commentCountByIdea.get(row.id) ?? 0,
      locationAvailable: !row.cfiRange ? false : !row.revisionId || !source.revisionId ? true : row.revisionId === source.revisionId,
    }
  })
}

export async function getIdeaDiscussion(userId: string | null, ideaId: string, revisionId?: string): Promise<IdeaDiscussion> {
  const { row, manager } = await readableIdea(userId, ideaId, true)
  const db = getDb()
  if (userId === row.userId && row.bookVersionId && pendingBookDataDeletionVersionIds(db, userId).includes(row.bookVersionId)) throw new AppError('ANNOTATION_NOT_FOUND')
  let sourceReadable = false
  if (row.bookVersionId) {
    try {
      if (row.sharedLibraryId) await assertIdeaSource(userId, row)
      else await assertReadableBook(userId, row.bookVersionId)
      sourceReadable = true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
  }
  const rows = db.select().from(ideaComments).where(eq(ideaComments.ideaId, row.id)).orderBy(asc(ideaComments.createdAt), asc(sql`rowid`)).all()

  const commentIds = rows.map((comment) => comment.id)
  const likesByComment = new Map<string, Array<{ userId: string }>>()
  if (commentIds.length > 0) {
    for (const like of db.select({ commentId: ideaCommentLikes.commentId, userId: ideaCommentLikes.userId }).from(ideaCommentLikes).where(inArray(ideaCommentLikes.commentId, commentIds)).all()) {
      const list = likesByComment.get(like.commentId) ?? []
      list.push(like)
      likesByComment.set(like.commentId, list)
    }
  }

  const ideaLikesList = db.select().from(ideaLikes).where(eq(ideaLikes.ideaId, row.id)).orderBy(asc(ideaLikes.createdAt), asc(ideaLikes.userId)).all()

  const userIds = new Set<string>()
  if (row.userId) userIds.add(row.userId)
  for (const comment of rows) {
    if (comment.userId) userIds.add(comment.userId)
    if (comment.replyToId) {
      const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
      if (replyTo?.userId) userIds.add(replyTo.userId)
    }
  }
  for (const like of ideaLikesList) {
    if (like.userId) userIds.add(like.userId)
  }

  const authorsById = new Map<string, IdeaAuthor>()
  if (userIds.size > 0) {
    for (const u of db.select({ id: users.id, name: users.username, avatarKey: users.avatarKey }).from(users).where(inArray(users.id, [...userIds])).all()) {
      authorsById.set(u.id, u)
    }
  }
  const resolveAuthor = (authorId: string | null): IdeaAuthor => {
    if (!authorId) return { id: '', name: 'Deleted user', avatarKey: null }
    return authorsById.get(authorId) ?? { id: authorId, name: 'Deleted user', avatarKey: null }
  }

  const comments: IdeaComment[] = rows.map((comment) => {
    const likes = likesByComment.get(comment.id) ?? []
    const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
    return {
      id: comment.id,
      parentId: comment.parentId,
      replyToId: comment.replyToId,
      replyToName: replyTo ? resolveAuthor(replyTo.userId).name : null,
      author: resolveAuthor(comment.userId),
      body: comment.deletedAt ? null : comment.body,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      deletedAt: comment.deletedAt,
      own: userId === comment.userId,
      canDelete: userId === comment.userId || manager,
      liked: likes.some((like) => like.userId === userId),
      likeCount: likes.length,
    }
  })
  const likers = ideaLikesList.map((like) => resolveAuthor(like.userId))
  const ideaProjected: ReaderIdea = {
    annotation: toRes('idea', row),
    author: resolveAuthor(row.userId),
    own: row.userId === userId,
    canDelete: row.userId === userId || manager,
    likeCount: ideaLikesList.length,
    liked: ideaLikesList.some((like) => like.userId === userId),
    commentCount: rows.filter((c) => !c.deletedAt).length,
    locationAvailable: sourceReadable && !!row.cfiRange && (!row.revisionId || !revisionId || row.revisionId === revisionId),
  }
  return { idea: ideaProjected, comments, likers }
}

export async function commentLikers(userId: string | null, ideaId: string, commentId: string) {
  await readableIdea(userId, ideaId)
  const db = getDb()
  const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get()
  if (!comment) throw new AppError('ANNOTATION_NOT_FOUND')
  const likes = db.select().from(ideaCommentLikes).where(eq(ideaCommentLikes.commentId, commentId)).orderBy(asc(ideaCommentLikes.createdAt), asc(ideaCommentLikes.userId)).all()
  if (likes.length === 0) return []
  const userIds = [...new Set(likes.map((l) => l.userId))]
  const usersById = new Map<string, IdeaAuthor>()
  for (const u of db.select({ id: users.id, name: users.username, avatarKey: users.avatarKey }).from(users).where(inArray(users.id, userIds)).all()) {
    usersById.set(u.id, u)
  }
  return likes.map((like) => usersById.get(like.userId) ?? { id: like.userId, name: 'Deleted user', avatarKey: null })
}

export async function createIdeaComment(userId: string, ideaId: string, input: { requestId?: string; body: string; replyToId?: string }) {
  const { row } = await readableIdea(userId, ideaId)
  const db = getDb()
  return db.transaction((tx) => {
    const receipt = findCommentReceipt(tx, userId, 'idea', ideaId, input)
    if (receipt) return receipt
    const replyTo = input.replyToId ? db.select().from(ideaComments).where(and(eq(ideaComments.id, input.replyToId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get() : null
    if (input.replyToId && !replyTo) throw new AppError('ANNOTATION_NOT_FOUND')
    const comment = { id: createId('ic'), ideaId, userId, parentId: replyTo ? replyTo.parentId ?? replyTo.id : null, replyToId: replyTo?.id ?? null, body: input.body, createdAt: Date.now() }
    tx.insert(ideaComments).values(comment).run()
    saveCommentReceipt(tx, userId, 'idea', ideaId, input, comment.id)
    recordInteractionNotification(tx, {
      userId: replyTo ? replyTo.userId : row.userId, actorId: userId, domain: 'idea',
      event: replyTo ? 'reply' : 'comment', targetId: ideaId, interactionId: comment.id, commentId: comment.id,
    })
    return comment.id
  })
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
  const { row } = await readableIdea(userId, ideaId)
  const db = getDb()
  db.transaction((tx) => {
    if (commentId) {
      const comment = db.select().from(ideaComments).where(and(eq(ideaComments.id, commentId), eq(ideaComments.ideaId, ideaId), isNull(ideaComments.deletedAt))).get()
      if (!comment) throw new AppError('ANNOTATION_NOT_FOUND')
      if (liked) {
        const result = tx.insert(ideaCommentLikes).values({ commentId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
        if (result.changes) recordInteractionNotification(tx, { userId: comment.userId, actorId: userId, domain: 'idea', event: 'like', targetId: ideaId, interactionId: commentId, commentId })
      }
      else db.delete(ideaCommentLikes).where(and(eq(ideaCommentLikes.commentId, commentId), eq(ideaCommentLikes.userId, userId))).run()
    } else if (liked) {
      const result = tx.insert(ideaLikes).values({ ideaId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
      if (result.changes) recordInteractionNotification(tx, { userId: row.userId, actorId: userId, domain: 'idea', event: 'like', targetId: ideaId, interactionId: ideaId })
    }
    else db.delete(ideaLikes).where(and(eq(ideaLikes.ideaId, ideaId), eq(ideaLikes.userId, userId))).run()
  })
}
