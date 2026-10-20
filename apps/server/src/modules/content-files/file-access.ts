import { eq } from 'drizzle-orm'

import type { ContentFileUpload } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentFiles } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { ideaComposerContext, readableIdea } from '../annotations/idea-access'
import { readableReview, reviewComposerContext } from '../reviews/review-access'

export async function assertContentUpload(userId: string, input: ContentFileUpload) {
  if (input.targetId) {
    const { row } = input.domain === 'review' ? await readableReview(userId, input.targetId) : await readableIdea(userId, input.targetId)
    if (row.userId !== userId) throw new AppError('CONTENT_FILE_NOT_FOUND')
    if (input.domain === 'idea' && 'bookVersionId' in row && row.bookVersionId !== input.bookVersionId) throw new AppError('CONTENT_FILE_NOT_FOUND')
  } else if (input.domain === 'review') {
    if (!(await reviewComposerContext(userId, input.bookVersionId)).eligible) throw new AppError('REVIEW_NOT_FOUND')
  } else await ideaComposerContext(userId, input.bookVersionId)
}

export async function readableContentFile(userId: string | null, id: string) {
  const row = getDb().select().from(contentFiles).where(eq(contentFiles.id, id)).get()
  if (!row || !row.ready) throw new AppError('CONTENT_FILE_NOT_FOUND')
  try {
    if (row.reviewId) await readableReview(userId, row.reviewId)
    else if (row.ideaId) await readableIdea(userId, row.ideaId, row.userId === userId)
    else if (row.userId !== userId) throw new AppError('CONTENT_FILE_NOT_FOUND')
  } catch (error) {
    if (error instanceof AppError) throw new AppError('CONTENT_FILE_NOT_FOUND')
    throw error
  }
  return row
}
