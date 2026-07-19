import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { readingProgress, books } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'

export async function getProgress(userId: string, bookId: string) {
  const db = getDb()
  const progress = db.select().from(readingProgress).where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId))).get()
  return progress ?? null
}

export async function upsertProgress(userId: string, bookId: string, data: { cfi?: string; chapter?: string; percent: number }) {
  const db = getDb()
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), isNull(books.deletedAt))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const existing = db.select().from(readingProgress).where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId))).get()
  const now = Date.now()
  if (existing) {
    db.update(readingProgress).set({ cfi: data.cfi, chapter: data.chapter, percent: data.percent, updatedAt: now }).where(eq(readingProgress.id, existing.id)).run()
    return { ...existing, ...data, updatedAt: now }
  }
  const newProgress = {
    id: createId('prog'),
    userId,
    bookId,
    cfi: data.cfi ?? null,
    chapter: data.chapter ?? null,
    percent: data.percent,
    updatedAt: now,
  }
  db.insert(readingProgress).values(newProgress).run()
  return newProgress
}
