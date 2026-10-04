import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from '../../middleware/error'
import settingsRoutes from './settings.routes'
import * as settingsService from './settings.service'

import { revokeLegadoAccessKey } from '../books/legado-access.service'

vi.mock('./settings.service', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getTrashSettings: vi.fn(() => ({ autoCleanDays: 30 })),
  updateTrashSettings: vi.fn(),
  getLibrarySettings: vi.fn(() => ({})),
  updateLibrarySettings: vi.fn(),
  getProfileSettings: vi.fn(() => ({})),
  updateProfileSettings: vi.fn(),
  getIntegrationsSettings: vi.fn(() => ({})),
  updateIntegrationsSettings: vi.fn(),
  isTrashEnabled: vi.fn(() => true),
  isTitleNormalizeEnabled: vi.fn(() => true),
  isLegadoEnabled: vi.fn(() => true),
}))

vi.mock('../books/legado-access.service', () => ({
  revokeLegadoAccessKey: vi.fn(),
}))

vi.mock('../books/books.service', () => ({
  emptyTrash: vi.fn(),
}))

vi.mock('../auth/auth.service', () => ({
  effectiveUploadMaxBytes: vi.fn(() => 104857600),
}))

function createApp(user: { id: string; username: string; role: string } = { id: 'u1', username: 'tester', role: 'owner' }, guest = false) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/settings/*', async (c, next) => {
    c.set('user', guest ? null : { ...user, avatarKey: null })
    if (guest) c.set('guest', true)
    return next()
  })
  app.route('/api/v1/settings', settingsRoutes)
  return app
}

describe('Settings routes - Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes integrations in GET /api/v1/settings', async () => {
    vi.mocked(settingsService.getIntegrationsSettings).mockReturnValue({
      legado: { enabled: true, authMode: 'login' },
    })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.integrations).toEqual({ legado: { enabled: true, authMode: 'login' } })
  })

  it('updates integrations in PUT /api/v1/settings', async () => {
    vi.mocked(settingsService.getIntegrationsSettings).mockReturnValue({
      legado: { enabled: true, authMode: 'login' },
    })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        integrations: {
          legado: { enabled: false, authMode: 'accessKey', includeEpubMedia: false },
        },
      }),
    })
    expect(res.status).toBe(200)
    expect(settingsService.updateIntegrationsSettings).toHaveBeenCalledWith('u1', {
      legado: { enabled: false, authMode: 'accessKey', includeEpubMedia: false },
    })
    expect(revokeLegadoAccessKey).toHaveBeenCalledWith('u1')
  })

  it('revokes access keys when switching back to login mode', async () => {
    vi.mocked(settingsService.getIntegrationsSettings).mockReturnValue({
      legado: { enabled: true, authMode: 'accessKey' },
    })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrations: { legado: { authMode: 'login' } } }),
    })

    expect(res.status).toBe(200)
    expect(revokeLegadoAccessKey).toHaveBeenCalledWith('u1')
  })

  it('rejects persistent settings writes from guests', async () => {
    const app = createApp({ id: 'guest-1', username: 'admin', role: 'guest' }, true)
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverFit: 'full' }),
    })

    expect(res.status).toBe(401)
    expect(settingsService.updateSettings).not.toHaveBeenCalled()
  })
})

describe('Settings routes - Library preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges library sort settings field-by-field without wiping siblings', async () => {
    vi.mocked(settingsService.getLibrarySettings).mockReturnValue({
      normalizeTitle: false,
      shelfSort: { mode: 'name', dir: 'asc' },
      view: 'list',
      hiddenLibraryIds: ['lib-keep'],
    })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library: {
          tagSort: { mode: 'bookCount', dir: 'desc' },
          bookSort: { field: 'title', dir: 'asc' },
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(settingsService.updateLibrarySettings).toHaveBeenCalledWith('u1', {
      normalizeTitle: false,
      shelfSort: { mode: 'name', dir: 'asc' },
      tagSort: { mode: 'bookCount', dir: 'desc' },
      bookSort: { field: 'title', dir: 'asc' },
      view: 'list',
      hiddenLibraryIds: ['lib-keep'],
    })
  })

  it('keeps a library field the client never sends, so a new field cannot be dropped by a stale merge', async () => {
    // The merge spreads the stored blob rather than re-listing fields: a
    // hand-written allowlist silently drops any field added to the contract
    // but forgotten in the route.
    vi.mocked(settingsService.getLibrarySettings).mockReturnValue({
      gridCardFields: ['title', 'progress'],
      readingStatsEnabled: false,
      recentlyReadStyle: 'cards',
    })

    const app = createApp()
    await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: { view: 'list' } }),
    })

    expect(settingsService.updateLibrarySettings).toHaveBeenCalledWith('u1', {
      gridCardFields: ['title', 'progress'],
      readingStatsEnabled: false,
      recentlyReadStyle: 'cards',
      view: 'list',
    })
  })

  it('merges profile preferences without wiping siblings', async () => {
    vi.mocked(settingsService.getProfileSettings).mockReturnValue({ showStats: true, isPublic: false })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { showShowcase: false } }),
    })

    expect(res.status).toBe(200)
    expect(settingsService.updateProfileSettings).toHaveBeenCalledWith('u1', {
      showStats: true,
      showShowcase: false,
      isPublic: false,
    })
  })

  it('stores the hidden-library list the sidebar sends', async () => {
    vi.mocked(settingsService.getLibrarySettings).mockReturnValue({ view: 'grid' })

    const app = createApp()
    const res = await app.request('http://test/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: { hiddenLibraryIds: ['lib-a', 'lib-b'] } }),
    })

    expect(res.status).toBe(200)
    expect(settingsService.updateLibrarySettings).toHaveBeenCalledWith('u1', {
      view: 'grid',
      hiddenLibraryIds: ['lib-a', 'lib-b'],
    })
  })
})
