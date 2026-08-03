import { Hono } from 'hono'
import { settingsUpdateSchema } from '@bookdock/shared'
import { getSettings, getTrashSettings, updateSettings, updateTrashSettings } from './settings.service'
import type { SettingsRes } from '@bookdock/shared'

const settingsRoutes = new Hono()

settingsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const data = getSettings(user.id)
  return c.json({ data: { ...(data ?? {}), trash: getTrashSettings(user.id) } })
})

settingsRoutes.put('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = settingsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const { trash, ...ui } = parsed.data
  // Merge instead of replace so partial clients (e.g. a trash-only update)
  // never wipe the reader preferences stored under the ui key
  if (Object.keys(ui).length > 0) {
    updateSettings(user.id, { ...(getSettings(user.id) ?? {}), ...ui } as SettingsRes)
  }
  if (trash) updateTrashSettings(user.id, trash)
  return c.json({ data: parsed.data })
})

export default settingsRoutes
