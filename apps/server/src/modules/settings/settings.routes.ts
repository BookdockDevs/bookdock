import { Hono } from 'hono'
import { settingsUpdateSchema } from '@bookdock/shared'
import { getSettings, updateSettings } from './settings.service'
import type { SettingsRes } from '@bookdock/shared'

const settingsRoutes = new Hono()

settingsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const data = getSettings(user.id)
  return c.json({ data: data ?? {} })
})

settingsRoutes.put('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = settingsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  updateSettings(user.id, parsed.data as SettingsRes)
  return c.json({ data: parsed.data })
})

export default settingsRoutes
