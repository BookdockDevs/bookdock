import { Hono } from 'hono'

import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  setupSchema,
  updateInstanceSchema,
  updateUsernameSchema,
  type AccountRes,
  type SetupRequiredRes,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { requireOwner } from '../../middleware/auth.guard'
import {
  changePassword,
  changeUsername,
  getInstanceInfo,
  isSetupRequired,
  login,
  register,
  revokeSession,
  setupUser,
  updateInstanceSettings,
} from './auth.service'
import { assertLoginAllowed, clearLoginFailures, createLoginRateLimitKey, recordLoginFailure } from './auth.rate-limit'
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie'

const authRoutes = new Hono()

authRoutes.get('/instance', (c) => {
  return c.json({ data: getInstanceInfo() })
})

authRoutes.patch('/instance', requireOwner(), async (c) => {
  const body = await c.req.json().catch(() => null)
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
  const body = await c.req.json().catch(() => null)
  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await setupUser(parsed.data.username, parsed.data.password)
  setSessionCookie(c, result.token)
  return c.json({ data: { user: result.user } })
})

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await register(parsed.data.username, parsed.data.password)
  setSessionCookie(c, result.token)
  return c.json({ data: { user: result.user } })
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const rateLimitKey = createLoginRateLimitKey(c, parsed.data.username)
  assertLoginAllowed(rateLimitKey)
  let result
  try {
    result = await login(parsed.data.username, parsed.data.password)
  } catch (err) {
    if (err instanceof AppError && err.code === 'UNAUTHORIZED') recordLoginFailure(rateLimitKey)
    throw err
  }
  clearLoginFailures(rateLimitKey)
  setSessionCookie(c, result.token)
  return c.json({ data: { user: result.user } })
})

authRoutes.post('/logout', (c) => {
  const token = readSessionToken(c)
  if (token) revokeSession(token)
  clearSessionCookie(c)
  return c.json({ data: { ok: true } })
})

authRoutes.post('/password', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  const body = await c.req.json().catch(() => null)
  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await changePassword(user.id, parsed.data.oldPassword, parsed.data.newPassword)
  // All sessions (including this one) are revoked; drop the dead cookie so
  // the client lands on login instead of retrying with it.
  clearSessionCookie(c)
  return c.json({ data: { ok: true } })
})

authRoutes.post('/username', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  const body = await c.req.json().catch(() => null)
  const parsed = updateUsernameSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const account = changeUsername(user.id, parsed.data.username)
  return c.json({ data: account } satisfies { data: AccountRes })
})

authRoutes.get('/me', (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  return c.json({ data: { ...user, guest: c.get('guest') === true } })
})

export default authRoutes
