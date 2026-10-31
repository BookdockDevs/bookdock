import { Hono } from 'hono'

import { AppError } from '../../middleware/error'
import { executeUndoReceipt } from '../../lib/undo'

const undoRoutes = new Hono()

undoRoutes.post('/:token', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  await executeUndoReceipt(user.id, c.req.param('token'))
  return c.json({ data: null })
})

export default undoRoutes
