import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { AppError, errorHandler } from '../../middleware/error'
import extRoutes from './ext.routes'
import {
  deleteExternalBook,
  getExternalBook,
  listExternalBooks,
  listExternalLibraries,
  updateExternalBook,
} from './ext.service'
import { requireLibraryManager } from '../libraries/library-access'
import { uploadBook, uploadCatalogBook } from '../books/books.service'
import { manageBookShare } from '../books/book-shares.service'
import { getExternalArchive, getExternalArchiveOverview } from './ext-archives.service'

vi.mock('../books/book-shares.service', () => ({ manageBookShare: vi.fn() }))
vi.mock('./ext-archives.service', () => ({ getExternalArchive: vi.fn(), getExternalArchiveOverview: vi.fn() }))

vi.mock('./ext.service', () => ({
  EXT_READ: { showHidden: true },
  listExternalLibraries: vi.fn(),
  listExternalBooks: vi.fn(),
  getExternalBook: vi.fn(),
  deleteExternalBook: vi.fn(),
  updateExternalBook: vi.fn(),
}))

// Naming a library on a delete is checked here rather than in the service, and
// the check reaches the database, so it is stubbed to keep this a route test.
vi.mock('../libraries/library-access', () => ({
  requireLibraryManager: vi.fn(async () => ({ library: {}, relation: 'owner' })),
}))

// The two upload paths reach storage, the format registry and the parser, so
// they are stubbed; what matters here is which one is chosen and what the route
// forwards to it.
vi.mock('../books/books.service', () => ({
  uploadBook: vi.fn(async () => ({ book: { id: 'v1' }, duplicated: false })),
  uploadCatalogBook: vi.fn(async () => ({ bookVersionId: 'v1', libraryBookId: 'lb1', duplicated: false })),
  getActiveBook: vi.fn(async () => ({
    filePath: 'blobs/aa/x.epub', title: 'T', author: 'A', format: 'epub', size: 1,
  })),
}))

// The upload route asks both of these about the instance/user, and both read the
// database, so they are stubbed to keep this a route test.
vi.mock('../auth/auth.service', () => ({ effectiveUploadMaxBytes: () => 1024 * 1024 * 1024 }))
vi.mock('../settings/settings.service', () => ({ isTitleNormalizeEnabled: () => false }))

const USER = { id: 'u1', username: 'ivan', role: 'member' as const, avatarKey: null }

function createApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/ext/*', async (c, next) => {
    c.set('user', USER)
    return next()
  })
  app.route('/api/v1/ext', extRoutes)
  return app
}

describe('external API routes', () => {
  beforeEach(() => {
    // Calls must not leak between cases: one test asserts a guard was *not*
    // reached, which the previous test's call would otherwise satisfy.
    vi.clearAllMocks()
    vi.mocked(listExternalLibraries).mockResolvedValue([])
    vi.mocked(listExternalBooks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, hasMore: false })
    vi.mocked(getExternalBook).mockResolvedValue({
      bookVersionId: 'v1', libraryId: 'lib1', libraryName: '', title: 'T', author: 'A', authors: [],
      versionName: '', sourceFormat: 'epub', size: 1, hasCover: false, categoryName: null, shelfName: null, tags: [],
      hidden: false, wordCount: null, createdAt: 1, updatedAt: 2, description: '', bookmeta: {}, fileName: 'T.epub', cover: null,
    })
    vi.mocked(deleteExternalBook).mockResolvedValue({ bookVersionId: 'v1' })
  })

  it('returns the libraries with their write access', async () => {
    vi.mocked(listExternalLibraries).mockResolvedValue([
      { id: 'lib1', name: 'Mine', type: 'private', role: 'owner', canWrite: true, memberCount: 1, workCount: 0, categories: [], shelves: [], tags: [] },
    ])

    const res = await createApp().request('/api/v1/ext/libraries')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { libraries: [{ id: 'lib1', name: 'Mine', type: 'private', role: 'owner', canWrite: true }] } })
  })

  it('defaults the list to the first page and passes the filters through', async () => {
    const res = await createApp().request(
      '/api/v1/ext/books?q=three&libraryId=lib1&format=epub&sortBy=title&sortOrder=asc&updatedSince=1700&page=2&pageSize=10'
      + '&author=Lin&categoryPath=%5B%22Fiction%22%5D&tag=Favorite&shelfId=s1&sortScope=global',
    )

    expect(res.status).toBe(200)
    expect(listExternalBooks).toHaveBeenCalledWith(USER.id, {
      q: 'three', libraryId: 'lib1', format: 'epub', sortBy: 'title', sortOrder: 'asc', updatedSince: 1700, page: 2, pageSize: 10,
      author: 'Lin', categoryPath: ['Fiction'], tag: 'Favorite', shelfId: 's1', sortScope: 'global',
    })
  })

  it('fills in the paging defaults so a bare request is still valid', async () => {
    const res = await createApp().request('/api/v1/ext/books')

    expect(res.status).toBe(200)
    expect(listExternalBooks).toHaveBeenCalledWith(USER.id, { page: 1, pageSize: 50 })
  })

  it('rejects a bad filter instead of silently ignoring it', async () => {
    const app = createApp()

    const badSort = await app.request('/api/v1/ext/books?sortBy=nonsense')
    expect(badSort.status).toBe(400)
    expect((await badSort.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')

    const badFormat = await app.request('/api/v1/ext/books?format=pdf')
    expect(badFormat.status).toBe(400)

    const badPage = await app.request('/api/v1/ext/books?page=0')
    expect(badPage.status).toBe(400)

    const hugePage = await app.request('/api/v1/ext/books?pageSize=1000')
    expect(hugePage.status).toBe(400)
    const invalidCategory = await app.request('/api/v1/ext/books?categoryPath=Fiction')
    expect(invalidCategory.status).toBe(400)
  })

  it('reads one version by id', async () => {
    const res = await createApp().request('/api/v1/ext/books/v1')

    expect(res.status).toBe(200)
    expect(getExternalBook).toHaveBeenCalledWith(USER.id, 'v1', undefined)
    expect(await res.json()).toMatchObject({ data: { bookVersionId: 'v1', cover: null } })
  })

  it('requires a file to upload', async () => {
    const app = createApp()

    const missing = await app.request('/api/v1/ext/books', { method: 'POST' })
    expect(missing.status).toBe(400)

    const empty = await app.request('/api/v1/ext/books', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      body: '--x--',
    })
    expect(empty.status).toBe(400)
  })

  it('keeps category and shelf placement separate for external uploads', async () => {
    const form = (fields: Record<string, string>) => {
      const parts = ['--x', 'Content-Disposition: form-data; name="file"; filename="a.epub"', 'Content-Type: application/epub+zip', '', 'PK', ...Object.entries(fields).flatMap(([k, v]) => [`--x`, `Content-Disposition: form-data; name="${k}"`, '', v]), '--x--', '']
      return { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: parts.join('\r\n') }
    }

    const filed = await createApp().request('/api/v1/ext/books', form({ libraryId: 'lib1', categoryPath: JSON.stringify(['cat1']), shelfId: 'shelf1' }))
    expect(filed.status).toBe(201)
    expect(uploadCatalogBook).toHaveBeenCalledWith('lib1', USER.id, expect.any(File), expect.objectContaining({ categoryPath: ['cat1'], shelfId: 'shelf1' }))

    vi.clearAllMocks()
    const privateShelf = await createApp().request('/api/v1/ext/books', form({ shelfId: 'shelf2' }))
    expect(privateShelf.status).toBe(201)
    expect(uploadBook).toHaveBeenCalledWith(USER.id, expect.any(File), { shelfId: 'shelf2', categoryPath: undefined }, expect.anything())

    vi.clearAllMocks()
    const privateCategory = await createApp().request('/api/v1/ext/books', form({ categoryPath: JSON.stringify(['cat1']) }))
    expect(privateCategory.status).toBe(201)
    expect(uploadBook).toHaveBeenCalledWith(USER.id, expect.any(File), { shelfId: undefined, categoryPath: ['cat1'] }, expect.anything())
  })

  it('trashes a version and checks the named library before acting on it', async () => {
    const res = await createApp().request('/api/v1/ext/books/v1?libraryId=lib1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(requireLibraryManager).toHaveBeenCalledWith(USER.id, 'lib1')
    expect(deleteExternalBook).toHaveBeenCalledWith(USER.id, 'v1', 'lib1')
  })

  it('does not ask about a library when none was named', async () => {
    const res = await createApp().request('/api/v1/ext/books/v1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(requireLibraryManager).not.toHaveBeenCalled()
  })

  it('surfaces a missing book as 404 rather than a server error', async () => {
    vi.mocked(getExternalBook).mockRejectedValue(new AppError('BOOK_NOT_FOUND', 'Book not found'))

    const res = await createApp().request('/api/v1/ext/books/missing')

    expect(res.status).toBe(404)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('BOOK_NOT_FOUND')
  })

  it('passes the selected library to detail and requires it for a work patch', async () => {
    const app = createApp()
    const path = '/api/v1/ext/books/v1'
    const patch = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"title":"Edited"}' }
    expect((await app.request(`${path}?libraryId=lib1`)).status).toBe(200)
    expect(getExternalBook).toHaveBeenCalledWith(USER.id, 'v1', 'lib1')
    expect((await app.request(path, patch)).status).toBe(400)
    vi.mocked(updateExternalBook).mockResolvedValue({ libraryId: 'lib1', bookVersionId: 'v1', libraryBookId: 'work1' })
    expect((await app.request(`${path}?libraryId=lib1`, patch)).status).toBe(200)
    expect(updateExternalBook).toHaveBeenCalledWith(USER.id, 'lib1', 'v1', { title: 'Edited' })
  })

  it('gets or revokes a download link on the same path', async () => {
    const app = createApp()
    const path = '/api/v1/ext/books/v1/download-link'
    const post = (body: object) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const get = post({ duration: '1d' })
    const revoke = post({ action: 'revoke', libraryId: 'lib1' })
    vi.mocked(manageBookShare).mockReturnValueOnce({ url: '/download', duration: '1h', expiresAt: 100 })
    expect(await (await app.request(path, get)).json()).toMatchObject({ data: { duration: '1h', expiresAt: 100 } })
    expect(manageBookShare).toHaveBeenLastCalledWith(USER.id, 'v1', undefined, { type: 'get-or-create', duration: '1d' })
    vi.mocked(manageBookShare).mockReturnValue(null)
    expect(await (await app.request(path, revoke)).json()).toEqual({ data: null })
    expect(manageBookShare).toHaveBeenLastCalledWith(USER.id, 'v1', 'lib1', { type: 'revoke' })
  })

  it('dispatches the archive overview and detail on one read route', async () => {
    const app = createApp()
    const path = '/api/v1/ext/reading-archives'
    vi.mocked(getExternalArchiveOverview).mockResolvedValue({
      view: 'overview',
      overview: {
        totalBooks: 0,
        counts: { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, total: 0 },
        reading: {
          summary: {
            totalSeconds: 75, totalBooks: 1, totalDays: 1, totalWordsRead: 0, todaySeconds: 75,
            undatedDurationSeconds: 0, referenceDurationSeconds: 0, currentStreak: 1, longestStreak: 1,
            weekSeconds: 75, prevWeekSeconds: 0, monthSeconds: 75, prevMonthSeconds: 0,
          },
          daily: [], hourly: [], byCategory: [], byTag: [],
        },
      },
      entries: [], page: 2, hasMore: false,
    })
    const overview = await app.request(`${path}?search=book&page=2`)
    expect(overview.status).toBe(200)
    expect(await overview.json()).toMatchObject({ data: { overview: { reading: { summary: { totalSeconds: 75 } } } } })
    expect(overview.headers.get('cache-control')).toBe('private, no-store')
    expect(getExternalArchiveOverview).toHaveBeenCalledWith(USER.id, expect.objectContaining({ search: 'book', page: 2 }))
    vi.mocked(getExternalArchive).mockResolvedValue({ view: 'data', archiveId: 'a1', data: null })
    expect((await app.request(`${path}?archiveId=a1&from=2026-01-01`)).status).toBe(200)
    expect(getExternalArchive).toHaveBeenCalledWith(USER.id, { archiveId: 'a1', view: 'data', from: '2026-01-01' })
    expect((await app.request(`${path}?archiveId=a1&view=export`)).status).toBe(400)
  })
})
