import { Hono } from 'hono'
import { loginSchema, setupSchema, type SetupRequiredRes } from '@bookdock/shared'
import { login, isSetupRequired, setupUser } from './auth.service'

const authRoutes = new Hono()

authRoutes.get('/setup-required', async (c) => {
  const required = await isSetupRequired()
  return c.json({ data: { required } } satisfies { data: SetupRequiredRes })
})

authRoutes.post('/setup', async (c) => {
  const body = await c.req.json()
  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await setupUser(parsed.data.username, parsed.data.password)
  return c.json({ data: result })
})

authRoutes.post('/login', async (c) => {
  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await login(parsed.data.username, parsed.data.password)
  return c.json({ data: result })
})

authRoutes.get('/me', (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  return c.json({ data: user })
})

export default authRoutes
