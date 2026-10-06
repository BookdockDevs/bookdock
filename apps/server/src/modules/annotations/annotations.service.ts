import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { bookmarks, highlights, ideas, ideaComments, ideaLikes, settings } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { assertReadableBook } from '../books/books.service'
import type { AnnotationCreateReq, AnnotationRes, AnnotationUpdateReq } from '@bookdock/shared'
import { assertIdeaSource, IDEA_VISIBILITY_KEY, ideaComposerContext, ideaRevision, privateIdeaLink, readableIdea } from './idea-access'

export function toRes(kind: 'highlight' | 'bookmark' | 'idea', row: {
  id: string
  userId: string
  bookVersionId: string | null
  cfiRange?: string | null
  cfiAnchor?: string | null
  cfi?: string | null
  color?: string
  style?: string
  text?: string | null
  note?: string | null
  title?: string | null
  contextText?: string | null
  chapter?: string | null
  chapterHref?: string | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  visibility?: 'private' | 'shared'
  revisionId?: string | null
  editedAt?: number | null
}): AnnotationRes {
  if (kind === 'highlight') {
    return {
      id: row.id, bookId: row.bookVersionId ?? '', cfiRange: row.cfiRange ?? '', cfiAnchor: row.cfiAnchor ?? null,
      type: 'highlight', color: row.color ?? 'yellow', style: (row.style ?? 'highlight') as AnnotationRes['style'],
      text: row.text ?? '', note: null, chapter: row.chapter ?? null, chapterHref: row.chapterHref ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt ?? null,
    }
  }
  if (kind === 'bookmark') {
    return {
      id: row.id, bookId: row.bookVersionId ?? '', cfiRange: row.cfi ?? '', cfiAnchor: null,
      type: 'bookmark', color: 'yellow', style: 'underline',
      text: row.title ?? '', contextText: row.contextText ?? null, note: null, chapter: row.chapter ?? null, chapterHref: row.chapterHref ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt ?? null,
    }
  }
  return {
    id: row.id, bookId: row.bookVersionId ?? '', cfiRange: row.cfiRange ?? '', cfiAnchor: row.cfiAnchor ?? null,
    type: 'note', color: row.color ?? 'yellow', style: (row.style ?? 'underline') as AnnotationRes['style'],
    visibility: row.visibility ?? 'private', revisionId: row.revisionId ?? null, editedAt: row.editedAt ?? null,
    text: row.text ?? '', note: row.note ?? null, chapter: row.chapter ?? null, chapterHref: row.chapterHref ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt ?? null,
  }
}

export async function listAnnotations(userId: string, bookId: string) {
  const db = getDb()
  const [hl, bm, ideaRows] = await Promise.all([
    db.select().from(highlights)
      .where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, bookId), isNull(highlights.deletedAt)))
      .orderBy(desc(highlights.createdAt), desc(highlights.id)).all(),
    db.select().from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookId), isNull(bookmarks.deletedAt)))
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).all(),
    db.select().from(ideas)
      .where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, bookId), isNull(ideas.deletedAt)))
      .orderBy(desc(ideas.createdAt), desc(ideas.id)).all(),
  ])
  const currentRevisionId = ideaRevision(userId, bookId)?.id ?? null
  const ideaIds = ideaRows.map((row) => row.id)
  const likes = ideaIds.length
    ? db.select({ ideaId: ideaLikes.ideaId, userId: ideaLikes.userId })
        .from(ideaLikes)
        .where(inArray(ideaLikes.ideaId, ideaIds))
        .all()
    : []
  const comments = ideaIds.length
    ? db.select({ ideaId: ideaComments.ideaId })
        .from(ideaComments)
        .where(and(inArray(ideaComments.ideaId, ideaIds), isNull(ideaComments.deletedAt)))
        .all()
    : []

  const likesByIdea = new Map<string, { count: number; liked: boolean }>()
  for (const like of likes) {
    const entry = likesByIdea.get(like.ideaId) ?? { count: 0, liked: false }
    entry.count += 1
    if (like.userId === userId) entry.liked = true
    likesByIdea.set(like.ideaId, entry)
  }

  const commentsByIdea = new Map<string, number>()
  for (const c of comments) {
    commentsByIdea.set(c.ideaId, (commentsByIdea.get(c.ideaId) ?? 0) + 1)
  }

  return [
    ...hl.map((row) => toRes('highlight', row)),
    ...bm.map((row) => toRes('bookmark', row)),
    // Legacy ideas predate revision provenance (revisionId null): they remain
    // locatable via CFI, so only an explicit revision mismatch disables them.
    ...ideaRows.map((row) => {
      const ideaLike = likesByIdea.get(row.id)
      const commentCount = commentsByIdea.get(row.id) ?? 0
      return {
        ...toRes('idea', row),
        likeCount: ideaLike?.count ?? 0,
        liked: ideaLike?.liked ?? false,
        commentCount,
        locationAvailable: !row.revisionId || !currentRevisionId || row.revisionId === currentRevisionId,
      }
    }),
  ]
}

export async function searchAnnotations(userId: string, bookId: string, query: string, limit = 8) {
  const normalized = query.trim().slice(0, 200)
  if (!normalized) return []
  const db = getDb()
  const hl = db.select().from(highlights)
    .where(and(
      eq(highlights.userId, userId),
      eq(highlights.bookVersionId, bookId),
      isNull(highlights.deletedAt),
      sql`(
        instr(lower(${highlights.text}), lower(${normalized})) > 0
        OR instr(lower(coalesce(${highlights.chapter}, '')), lower(${normalized})) > 0
      )`,
    ))
    .orderBy(desc(highlights.updatedAt), desc(highlights.id))
    .limit(Math.min(Math.max(limit, 1), 20))
    .all()
  const bm = db.select().from(bookmarks)
    .where(and(
      eq(bookmarks.userId, userId),
      eq(bookmarks.bookVersionId, bookId),
      isNull(bookmarks.deletedAt),
      sql`(
        instr(lower(coalesce(${bookmarks.title}, '')), lower(${normalized})) > 0
        OR instr(lower(coalesce(${bookmarks.chapter}, '')), lower(${normalized})) > 0
        OR instr(lower(coalesce(${bookmarks.contextText}, '')), lower(${normalized})) > 0
      )`,
    ))
    .orderBy(desc(bookmarks.updatedAt), desc(bookmarks.id))
    .limit(Math.min(Math.max(limit, 1), 20))
    .all()
  const ideaRows = db.select().from(ideas)
    .where(and(
      eq(ideas.userId, userId),
      eq(ideas.bookVersionId, bookId),
      isNull(ideas.deletedAt),
      sql`(
        instr(lower(${ideas.text}), lower(${normalized})) > 0
        OR instr(lower(coalesce(${ideas.note}, '')), lower(${normalized})) > 0
        OR instr(lower(coalesce(${ideas.chapter}, '')), lower(${normalized})) > 0
      )`,
    ))
    .orderBy(desc(ideas.updatedAt), desc(ideas.id))
    .limit(Math.min(Math.max(limit, 1), 20))
    .all()
  return [
    ...hl.map((row) => toRes('highlight', row)),
    ...bm.map((row) => toRes('bookmark', row)),
    ...ideaRows.map((row) => toRes('idea', row)),
  ]
}

export async function createAnnotation(userId: string, bookId: string, data: AnnotationCreateReq, showHidden = false) {
  const db = getDb()
  // Reading data belongs to User x BookVersion, not to a private card: anyone
  // with read rights may annotate, with or without collecting first. Guests
  // never reach here (mutations are guest-refused at the guard).
  await assertReadableBook(userId, bookId, showHidden)
  const now = Date.now()
  if (data.type === 'highlight') {
    // A soft-deleted highlight at this CFI is restored instead of forked.
    const existing = db.select().from(highlights)
      .where(and(
        eq(highlights.userId, userId),
        eq(highlights.bookVersionId, bookId),
        eq(highlights.cfiRange, data.cfiRange),
      )).get()
    if (existing) {
      db.update(highlights).set({
        cfiAnchor: data.cfiAnchor ?? existing.cfiAnchor,
        color: data.color ?? existing.color,
        style: data.style ?? existing.style,
        text: data.text ?? existing.text,
        chapter: data.chapter ?? existing.chapter,
        chapterHref: data.chapterHref ?? existing.chapterHref,
        deletedAt: null,
        updatedAt: now,
      }).where(eq(highlights.id, existing.id)).run()
      return toRes('highlight', db.select().from(highlights).where(eq(highlights.id, existing.id)).get()!)
    }
    const row = {
      id: createId('hl'),
      userId,
      bookVersionId: bookId,
      revisionId: null,
      cfiRange: data.cfiRange,
      cfiAnchor: data.cfiAnchor ?? null,
      color: data.color ?? 'yellow',
      style: data.style ?? 'highlight',
      text: data.text ?? '',
      chapter: data.chapter ?? null,
      chapterHref: data.chapterHref ?? null,
      relocation: 'ok' as const,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    db.insert(highlights).values(row).run()
    return toRes('highlight', row)
  }
  if (data.type === 'bookmark') {
    const existing = db.select().from(bookmarks)
      .where(and(
        eq(bookmarks.userId, userId),
        eq(bookmarks.bookVersionId, bookId),
        eq(bookmarks.cfi, data.cfiRange),
      )).get()
    if (existing) {
      db.update(bookmarks).set({
        chapter: data.chapter ?? existing.chapter,
        chapterHref: data.chapterHref ?? existing.chapterHref,
        // Restoring refreshes the snippet like the legacy path did: an
        // explicit new text wins, otherwise the surviving title stays.
        title: data.text ?? existing.title,
        contextText: data.contextText ?? existing.contextText,
        deletedAt: null,
        updatedAt: now,
      }).where(eq(bookmarks.id, existing.id)).run()
      return toRes('bookmark', db.select().from(bookmarks).where(eq(bookmarks.id, existing.id)).get()!)
    }
    const row = {
      id: createId('bm'),
      userId,
      bookVersionId: bookId,
      revisionId: null,
      cfi: data.cfiRange,
      chapter: data.chapter ?? null,
      chapterHref: data.chapterHref ?? null,
      title: data.text ?? null,
      contextText: data.contextText ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    db.insert(bookmarks).values(row).run()
    return toRes('bookmark', row)
  }
  // Notes are exempt from dedup: rereads produce new ideas on the same range.
  const context = await ideaComposerContext(userId, bookId)
  const visibility = data.visibility ?? context.defaultVisibility
  const link = privateIdeaLink(userId, bookId)
  if (visibility === 'shared' && (!context.eligible || !context.sourceReadable)) throw new AppError('ANNOTATION_NOT_FOUND')
  const revision = ideaRevision(userId, bookId)
  if (data.revisionId && data.revisionId !== revision?.id) throw new AppError('VALIDATION_ERROR', 'The reading revision has changed')
  const row = {
    id: createId('idea'),
    userId,
    bookVersionId: bookId,
    cfiRange: data.cfiRange,
    cfiAnchor: data.cfiAnchor ?? null,
    color: data.color ?? 'yellow',
    style: data.style ?? 'underline',
    text: data.text ?? '',
    note: data.note ?? null,
    visibility,
    sharedLibraryId: context.eligible ? link!.sourceLibraryId : null,
    sourceLibraryBookVersionId: context.eligible ? link!.sourceLibraryBookVersionId : null,
    revisionId: data.revisionId === null ? null : revision?.id ?? null,
    chapter: data.chapter ?? null,
    chapterHref: data.chapterHref ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  db.transaction((tx) => {
    tx.insert(ideas).values(row).run()
    if (context.eligible) {
      tx.insert(settings).values({ id: createId('setting'), userId, key: IDEA_VISIBILITY_KEY, value: visibility })
        .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value: visibility } }).run()
    }
  })
  return toRes('idea', row)
}

type OwnedAnnotation =
  | { kind: 'highlight'; row: typeof highlights.$inferSelect }
  | { kind: 'bookmark'; row: typeof bookmarks.$inferSelect }
  | { kind: 'idea'; row: typeof ideas.$inferSelect }

async function ownedAnnotation(userId: string, annotationId: string): Promise<OwnedAnnotation> {
  const db = getDb()
  const highlight = db.select().from(highlights).where(eq(highlights.id, annotationId)).get()
  if (highlight && highlight.userId === userId) return { kind: 'highlight', row: highlight }
  const bookmark = db.select().from(bookmarks).where(eq(bookmarks.id, annotationId)).get()
  if (bookmark && bookmark.userId === userId) return { kind: 'bookmark', row: bookmark }
  const idea = db.select().from(ideas).where(eq(ideas.id, annotationId)).get()
  if (idea && idea.userId === userId) return { kind: 'idea', row: idea }
  throw new AppError('ANNOTATION_NOT_FOUND')
}

export async function updateAnnotation(userId: string, annotationId: string, data: AnnotationUpdateReq) {
  const db = getDb()
  const owned = await ownedAnnotation(userId, annotationId)
  const now = Date.now()
  if (owned.kind === 'highlight') {
    db.update(highlights).set({
      color: data.color ?? owned.row.color,
      style: data.style ?? owned.row.style,
      text: data.text ?? owned.row.text,
      updatedAt: now,
    }).where(eq(highlights.id, owned.row.id)).run()
    return toRes('highlight', { ...owned.row, color: data.color ?? owned.row.color, style: data.style ?? owned.row.style, text: data.text ?? owned.row.text, updatedAt: now })
  }
  if (owned.kind === 'bookmark') {
    // The rename entry point writes the title through text; nothing else on
    // a bookmark is user-editable.
    db.update(bookmarks).set({
      title: data.text ?? owned.row.title,
      updatedAt: now,
    }).where(eq(bookmarks.id, owned.row.id)).run()
    return toRes('bookmark', { ...owned.row, title: data.text ?? owned.row.title, updatedAt: now })
  }
  const visibility = data.visibility ?? owned.row.visibility
  let source = { sharedLibraryId: owned.row.sharedLibraryId, sourceLibraryBookVersionId: owned.row.sourceLibraryBookVersionId }
  if (visibility === 'shared' && owned.row.visibility !== 'shared') {
    const link = privateIdeaLink(userId, owned.row.bookVersionId ?? '')
    if (!link || link.kind !== 'shared') throw new AppError('ANNOTATION_NOT_FOUND')
    if (!source.sharedLibraryId && !source.sourceLibraryBookVersionId) {
      source = { sharedLibraryId: link.sourceLibraryId, sourceLibraryBookVersionId: link.sourceLibraryBookVersionId }
    }
    if (source.sharedLibraryId !== link.sourceLibraryId || source.sourceLibraryBookVersionId !== link.sourceLibraryBookVersionId) throw new AppError('ANNOTATION_NOT_FOUND')
  }
  if (visibility === 'shared') await assertIdeaSource(userId, { ...source, bookVersionId: owned.row.bookVersionId })
  if (data.text !== undefined && data.text !== owned.row.text) throw new AppError('VALIDATION_ERROR', 'The original quotation is immutable')
  const patch = {
    ...source, visibility,
    color: data.color ?? owned.row.color,
    style: data.style ?? owned.row.style,
    text: data.text ?? owned.row.text,
    note: data.note ?? owned.row.note,
    updatedAt: now,
    editedAt: data.note !== undefined && data.note !== owned.row.note ? now : owned.row.editedAt,
  }
  db.update(ideas).set(patch).where(eq(ideas.id, owned.row.id)).run()
  return toRes('idea', { ...owned.row, ...patch })
}

export async function deleteAnnotation(userId: string, annotationId: string) {
  const db = getDb()
  let owned: OwnedAnnotation
  try {
    owned = await ownedAnnotation(userId, annotationId)
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    const access = await readableIdea(userId, annotationId)
    if (!access.manager) throw new AppError('ANNOTATION_NOT_FOUND')
    owned = { kind: 'idea', row: access.row }
  }
  const now = Date.now()
  if (owned.kind === 'highlight') {
    db.update(highlights).set({ deletedAt: now, updatedAt: now }).where(eq(highlights.id, owned.row.id)).run()
    return toRes('highlight', { ...owned.row, deletedAt: now, updatedAt: now })
  }
  if (owned.kind === 'bookmark') {
    db.update(bookmarks).set({ deletedAt: now, updatedAt: now }).where(eq(bookmarks.id, owned.row.id)).run()
    return toRes('bookmark', { ...owned.row, deletedAt: now, updatedAt: now })
  }
  if (owned.row.visibility === 'shared') await assertIdeaSource(userId, owned.row)
  db.transaction((tx) => {
    tx.delete(ideaComments).where(eq(ideaComments.ideaId, owned.row.id)).run()
    tx.delete(ideaLikes).where(eq(ideaLikes.ideaId, owned.row.id)).run()
    tx.update(ideas).set({ deletedAt: now, updatedAt: now }).where(eq(ideas.id, owned.row.id)).run()
  })
  return toRes('idea', { ...owned.row, deletedAt: now, updatedAt: now })
}
