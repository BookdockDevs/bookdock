import { Hono } from 'hono'

import { ideaCommentCreateSchema, ideaCommentUpdateSchema, ideaLikeSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { ideaComposerContext } from './idea-access'
import { commentLikers, createIdeaComment, deleteIdeaComment, getIdeaDiscussion, listReaderIdeas, setIdeaLike, updateIdeaComment } from './idea-discussion.service'

const ideaRoutes = new Hono()

ideaRoutes.get('/book/:bookId/composer', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  return c.json({ data: await ideaComposerContext(user.id, c.req.param('bookId')) })
})

ideaRoutes.get('/book/:bookId', async (c) => {
  const libraryId = c.req.query('libraryId')
  const listingId = c.req.query('listingId')
  const revisionId = c.req.query('revisionId')
  if (!libraryId || !listingId || !revisionId) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await listReaderIdeas(c.get('user')?.id ?? null, { libraryId, listingId, revisionId, bookId: c.req.param('bookId') }) })
})

ideaRoutes.get('/:ideaId', async (c) => c.json({ data: await getIdeaDiscussion(c.get('user')?.id ?? null, c.req.param('ideaId'), c.req.query('revisionId')) }))

ideaRoutes.get('/:ideaId/comments/:commentId/likers', async (c) => c.json({ data: await commentLikers(c.get('user')?.id ?? null, c.req.param('ideaId'), c.req.param('commentId')) }))

ideaRoutes.post('/:ideaId/comments', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = ideaCommentCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: { id: await createIdeaComment(user.id, c.req.param('ideaId'), parsed.data) } }, 201)
})

ideaRoutes.put('/:ideaId/comments/:commentId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = ideaCommentUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await updateIdeaComment(user.id, c.req.param('ideaId'), c.req.param('commentId'), parsed.data.body)
  return c.json({ data: null })
})

ideaRoutes.delete('/:ideaId/comments/:commentId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  await deleteIdeaComment(user.id, c.req.param('ideaId'), c.req.param('commentId'))
  return c.json({ data: null })
})

ideaRoutes.put('/:ideaId/like', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = ideaLikeSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await setIdeaLike(user.id, c.req.param('ideaId'), parsed.data.liked)
  return c.json({ data: null })
})

ideaRoutes.put('/:ideaId/comments/:commentId/like', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = ideaLikeSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  await setIdeaLike(user.id, c.req.param('ideaId'), parsed.data.liked, c.req.param('commentId'))
  return c.json({ data: null })
})

export default ideaRoutes
