import { Hono } from 'hono'

import { accessTokenCreateSchema, accessTokenUpdateSchema } from '@bookdock/shared'
import type { AccessTokenCreateRes, AccessTokenListRes } from '@bookdock/shared'

import { createAccessToken, deleteAccessToken, listAccessTokens, setAccessTokenDisabled, updateAccessToken } from './tokens.service'

const tokensRoutes = new Hono()

// A guest session is a shared anonymous identity, and a token it issued would
// outlive that session, so guests cannot reach the token surface at all.
tokensRoutes.use('*', async (c, next) => {
  if (c.get('guest')) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage access tokens' } }, 403)
  }
  return next()
})

tokensRoutes.get('/', (c) => {
  const user = c.get('user')
  const data: AccessTokenListRes = { tokens: listAccessTokens(user.id) }
  return c.json({ data })
})

tokensRoutes.post('/', async (c) => {
  const user = c.get('user')
  const parsed = accessTokenCreateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const data: AccessTokenCreateRes = createAccessToken(user.id, parsed.data)
  return c.json({ data }, 201)
})

tokensRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const parsed = accessTokenUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateAccessToken(user.id, c.req.param('id'), parsed.data) })
})

tokensRoutes.post('/:id/disable', (c) => {
  const user = c.get('user')
  return c.json({ data: setAccessTokenDisabled(user.id, c.req.param('id'), true) })
})

tokensRoutes.post('/:id/enable', (c) => {
  const user = c.get('user')
  return c.json({ data: setAccessTokenDisabled(user.id, c.req.param('id'), false) })
})

tokensRoutes.delete('/:id', (c) => {
  const user = c.get('user')
  deleteAccessToken(user.id, c.req.param('id'))
  return c.json({ data: null })
})

export default tokensRoutes
