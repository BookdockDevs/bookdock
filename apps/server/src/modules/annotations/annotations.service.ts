import { eq, and } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { annotations } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import type { AnnotationCreateReq, AnnotationUpdateReq } from '@bookdock/shared'

export async function listAnnotations(userId: string, bookId: string) {
  const db = getDb()
  return db.select().from(annotations)
    .where(and(eq(annotations.userId, userId), eq(annotations.bookId, bookId)))
    .all()
}

export async function createAnnotation(userId: string, bookId: string, data: AnnotationCreateReq) {
  const db = getDb()
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
  db.delete(annotations).where(eq(annotations.id, annotationId)).run()
  return existing
}