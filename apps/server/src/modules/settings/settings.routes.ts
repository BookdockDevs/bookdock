import { Hono } from 'hono'
import { settingsUpdateSchema } from '@bookdock/shared'
import { getSettings, getTrashSettings, updateSettings, updateTrashSettings } from './settings.service'
import { emptyTrash } from '../books/books.service'
import { config } from '../../config'
import type { SettingsRes, TrashSettings } from '@bookdock/shared'

const settingsRoutes = new Hono()

settingsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const data = getSettings(user.id)
  // uploadMaxBytes is instance-level read-only info; settingsUpdateSchema
  // strips it from PUT bodies, so it is never persisted per user.
  return c.json({ data: { ...(data ?? {}), trash: getTrashSettings(user.id), uploadMaxBytes: config.uploadMaxBytes } })
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
  if (trash) {
    const current = getTrashSettings(user.id)
    const merged: TrashSettings = {
      autoCleanDays: trash.autoCleanDays ?? current.autoCleanDays,
      enabled: trash.enabled ?? current.enabled,
    }
    // Turning trash off is destructive by design: the UI confirms that the
    // current contents will be permanently deleted, and this honors that.
    if (merged.enabled === false) await emptyTrash(user.id)
    updateTrashSettings(user.id, merged)
  }
  return c.json({ data: parsed.data })
})

export default settingsRoutes
