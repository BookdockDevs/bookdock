import { Hono } from 'hono'

import {
  archiveQuerySchema,
  reviewCommentCreateSchema,
  reviewCommentUpdateSchema,
  reviewCreateSchema,
  reviewLikeSchema,
  reviewUpdateSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import {
  createReview,
  deleteReview,
  getReviewBookContext,
  getReviewWorkContext,
  myReviews,
  readerProfile,
  updateReview,
} from './reviews.service'
import {
  createReviewComment,
  deleteReviewComment,
  getReviewDiscussion,
  reviewCommentLikers,
  setReviewLike,
  updateReviewComment,
} from './review-discussion.service'

const reviewRoutes = new Hono()

reviewRoutes.get('/by-book/:bookVersionId', async (c) =>
  c.json({ data: await getReviewBookContext(c.get('user')?.id ?? null, c.req.param('bookVersionId')) }),
)

reviewRoutes.get('/work', async (c) => {
  const libraryId = c.req.query('libraryId')
  const libraryBookId = c.req.query('libraryBookId')
  if (!libraryId || !libraryBookId) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await getReviewWorkContext(c.get('user')?.id ?? null, libraryId, libraryBookId) })
})

reviewRoutes.get('/mine', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const query = archiveQuerySchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await myReviews(user.id, query.data) })
})

reviewRoutes.get('/author/:userId', async (c) => {
  const query = archiveQuerySchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await readerProfile(c.get('user')?.id ?? null, c.req.param('userId'), query.data) })
})

reviewRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await createReview(user.id, parsed.data) }, 201)
})

reviewRoutes.get('/:reviewId', async (c) =>
  c.json({ data: await getReviewDiscussion(c.get('user')?.id ?? null, c.req.param('reviewId')) }),
)

reviewRoutes.put('/:reviewId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await updateReview(user.id, c.req.param('reviewId'), parsed.data) })
})

reviewRoutes.delete('/:reviewId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  return c.json({ data: await deleteReview(user.id, c.req.param('reviewId')) })
})

reviewRoutes.get('/:reviewId/comments/:commentId/likers', async (c) =>
  c.json({
    data: await reviewCommentLikers(c.get('user')?.id ?? null, c.req.param('reviewId'), c.req.param('commentId')),
  }),
)

reviewRoutes.post('/:reviewId/comments', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewCommentCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: { id: await createReviewComment(user.id, c.req.param('reviewId'), parsed.data) } }, 201)
})

reviewRoutes.put('/:reviewId/comments/:commentId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewCommentUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await updateReviewComment(user.id, c.req.param('reviewId'), c.req.param('commentId'), parsed.data.body)
  return c.json({ data: null })
})

reviewRoutes.delete('/:reviewId/comments/:commentId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  await deleteReviewComment(user.id, c.req.param('reviewId'), c.req.param('commentId'))
  return c.json({ data: null })
})

reviewRoutes.put('/:reviewId/like', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewLikeSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await setReviewLike(user.id, c.req.param('reviewId'), parsed.data.liked)
  return c.json({ data: null })
})

reviewRoutes.put('/:reviewId/comments/:commentId/like', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = reviewLikeSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await setReviewLike(user.id, c.req.param('reviewId'), parsed.data.liked, c.req.param('commentId'))
  return c.json({ data: null })
})

export default reviewRoutes
