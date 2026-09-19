import { Hono } from 'hono'
import { settingsUpdateSchema } from '@bookdock/shared'
import {
  getIntegrationsSettings,
  getLibrarySettings,
  getSettings,
  getTrashSettings,
  updateIntegrationsSettings,
  updateLibrarySettings,
  updateSettings,
  updateTrashSettings,
} from './settings.service'
import { emptyTrash } from '../books/books.service'
import { revokeLegadoAccessKey } from '../books/legado-access.service'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import type { IntegrationsSettings, LibrarySettings, SettingsRes, TrashSettings } from '@bookdock/shared'

const settingsRoutes = new Hono()

settingsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const data = getSettings(user.id)
  // uploadMaxBytes is the effective instance-level limit (owner-editable, env
  // fallback); settingsUpdateSchema strips it from PUT bodies, so it is never
  // persisted per user.
  return c.json({
    data: {
      ...(data ?? {}),
      trash: getTrashSettings(user.id),
      library: getLibrarySettings(user.id),
      integrations: getIntegrationsSettings(user.id),
      uploadMaxBytes: effectiveUploadMaxBytes(),
    },
  })
})

settingsRoutes.put('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = settingsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const { trash, library, integrations, ...ui } = parsed.data
  // Merge instead of replace so partial clients (e.g. a trash-only update)
  // never wipe the reader preferences stored under the ui key
  if (Object.keys(ui).length > 0) {
    updateSettings(user.id, { ...(getSettings(user.id) ?? {}), ...ui } as SettingsRes)
  }
  if (library) {
    const current = getLibrarySettings(user.id)
    const merged: LibrarySettings = {
      normalizeTitle: library.normalizeTitle ?? current.normalizeTitle,
    }
    updateLibrarySettings(user.id, merged)
  }
  if (integrations) {
    const current = getIntegrationsSettings(user.id)
    const merged: IntegrationsSettings = {
      legado: {
        enabled: integrations.legado?.enabled ?? current.legado?.enabled,
        authMode: integrations.legado?.authMode ?? current.legado?.authMode,
        includeEpubMedia: integrations.legado?.includeEpubMedia ?? current.legado?.includeEpubMedia,
      },
    }
    updateIntegrationsSettings(user.id, merged)
    if (merged.legado?.enabled !== true || merged.legado.authMode !== 'accessKey') {
      revokeLegadoAccessKey(user.id)
    }
  }
  if (trash) {
    const current = getTrashSettings(user.id)
    const merged: TrashSettings = {
      autoCleanDays: trash.autoCleanDays ?? current.autoCleanDays,
      maxTrashBytes: trash.maxTrashBytes ?? current.maxTrashBytes,
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
