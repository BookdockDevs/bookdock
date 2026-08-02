import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  setupSchema,
  updateInstanceSchema,
  type SetupRequiredRes,
} from '@bookdock/shared'

import {
  changePassword,
  getInstanceInfo,
  isSetupRequired,
  login,
  register,
  setupUser,
  updateInstanceSettings,
} from './auth.service'
import { requireOwner } from '../../middleware/auth.guard'

const TOKEN_COOKIE = 'bd_token'
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60

function setTokenCookie(c: Context, token: string) {
  setCookie(c, TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: TOKEN_MAX_AGE,
  })
}

const authRoutes = new Hono()

authRoutes.get('/instance', (c) => {
  return c.json({ data: getInstanceInfo() })
})

authRoutes.patch('/instance', requireOwner(), async (c) => {
  const body = await c.req.json()
  const parsed = updateInstanceSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  return c.json({ data: updateInstanceSettings(parsed.data) })
})

authRoutes.get('/setup-required', async (c) => {
  const required = isSetupRequired()
  return c.json({ data: { required } } satisfies { data: SetupRequiredRes })
})

authRoutes.post('/setup', async (c) => {
  const body = await c.req.json()
  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await setupUser(parsed.data.username, parsed.data.password)
  setTokenCookie(c, result.token)
  return c.json({ data: result })
})

authRoutes.post('/register', async (c) => {
  const body = await c.req.json()
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await register(parsed.data.username, parsed.data.password)
  setTokenCookie(c, result.token)
  return c.json({ data: result })
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await login(parsed.data.username, parsed.data.password)
  setTokenCookie(c, result.token)
  return c.json({ data: result })
})

authRoutes.post('/logout', (c) => {
  deleteCookie(c, TOKEN_COOKIE, { path: '/' })
  return c.json({ data: { ok: true } })
})

authRoutes.post('/password', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  const body = await c.req.json()
  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await changePassword(user.id, parsed.data.oldPassword, parsed.data.newPassword)
  return c.json({ data: { ok: true } })
})

authRoutes.get('/me', (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  return c.json({ data: { ...user, guest: c.get('guest') === true } })
})

export default authRoutes
