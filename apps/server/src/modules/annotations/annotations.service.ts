import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { annotations, books } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import type { AnnotationCreateReq, AnnotationUpdateReq } from '@bookdock/shared'

export async function listAnnotations(userId: string, bookId: string) {
  const db = getDb()
  return db.select().from(annotations)
    .where(and(eq(annotations.userId, userId), eq(annotations.bookId, bookId), isNull(annotations.deletedAt)))
    .all()
}

export async function createAnnotation(userId: string, bookId: string, data: AnnotationCreateReq) {
  const db = getDb()
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const now = Date.now()
  const annotation = {
    id: createId('anno'),
    userId,
    bookId,
    cfiRange: data.cfiRange,
    cfiAnchor: data.cfiAnchor ?? null,
    type: data.type,
    color: data.color ?? 'yellow',
    style: data.style ?? 'underline',
    text: data.text ?? '',
    note: data.note ?? null,
    chapter: data.chapter ?? null,
    createdAt: now,
    updatedAt: now,
  }
  // If a soft-deleted annotation at this CFI + type exists, restore it instead.
  // Notes are exempt: multiple ideas on the same range are allowed (rereads
  // produce new ones), so a note always inserts a fresh row.
  const existing = data.type === 'note' ? undefined : db.select().from(annotations)
    .where(and(
      eq(annotations.userId, userId),
      eq(annotations.bookId, bookId),
      eq(annotations.cfiRange, data.cfiRange),
      eq(annotations.type, data.type),
    )).get()
  if (existing) {
    db.update(annotations).set({
      ...annotation,
      deletedAt: null,
      updatedAt: now,
    }).where(eq(annotations.id, existing.id)).run()
    return db.select().from(annotations).where(eq(annotations.id, existing.id)).get()!
  }
  db.insert(annotations).values(annotation).run()
  return annotation
}

export async function updateAnnotation(userId: string, annotationId: string, data: AnnotationUpdateReq) {
  const db = getDb()
  const existing = db.select().from(annotations).where(eq(annotations.id, annotationId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('ANNOTATION_NOT_FOUND')
  const updated = {
    color: data.color ?? existing.color,
    style: data.style ?? existing.style,
    note: data.note ?? existing.note,
    text: data.text ?? existing.text,
    updatedAt: Date.now(),
  }
  db.update(annotations).set(updated).where(eq(annotations.id, annotationId)).run()
  return { ...existing, ...updated }
}

export async function deleteAnnotation(userId: string, annotationId: string) {
  const db = getDb()
  const existing = db.select().from(annotations).where(eq(annotations.id, annotationId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('ANNOTATION_NOT_FOUND')
  db.update(annotations).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(annotations.id, annotationId)).run()
  return existing
}