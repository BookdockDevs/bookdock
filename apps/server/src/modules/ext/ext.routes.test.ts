import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { AppError, errorHandler } from '../../middleware/error'
import extRoutes from './ext.routes'
import {
  deleteExternalBook,
  getExternalBook,
  listExternalBooks,
  listExternalLibraries,
} from './ext.service'
import { requireLibraryManager } from '../libraries/library-access'
import { uploadBook, uploadCatalogBook } from '../books/books.service'

vi.mock('./ext.service', () => ({
  EXT_READ: { showHidden: true },
  listExternalLibraries: vi.fn(),
  listExternalBooks: vi.fn(),
  getExternalBook: vi.fn(),
  deleteExternalBook: vi.fn(),
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
      versionName: '', sourceFormat: 'epub', size: 1, hasCover: false, categoryName: null, tags: [],
      hidden: false, wordCount: null, createdAt: 1, updatedAt: 2, description: '', bookmeta: {}, fileName: 'T.epub', cover: null,
    })
    vi.mocked(deleteExternalBook).mockResolvedValue({ bookVersionId: 'v1' })
  })

  it('returns the libraries with their write access', async () => {
    vi.mocked(listExternalLibraries).mockResolvedValue([
      { id: 'lib1', name: 'Mine', type: 'private', role: 'owner', canWrite: true },
    ])

    const res = await createApp().request('/api/v1/ext/libraries')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { libraries: [{ id: 'lib1', name: 'Mine', type: 'private', role: 'owner', canWrite: true }] } })
  })

  it('defaults the list to the first page and passes the filters through', async () => {
    const res = await createApp().request(
      '/api/v1/ext/books?q=three&libraryId=lib1&format=epub&sortBy=title&sortOrder=asc&updatedSince=1700&page=2&pageSize=10',
    )

    expect(res.status).toBe(200)
    expect(listExternalBooks).toHaveBeenCalledWith(USER.id, {
      q: 'three', libraryId: 'lib1', format: 'epub', sortBy: 'title', sortOrder: 'asc', updatedSince: 1700, page: 2, pageSize: 10,
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
  })

  it('reads one version by id', async () => {
    const res = await createApp().request('/api/v1/ext/books/v1')

    expect(res.status).toBe(200)
    expect(getExternalBook).toHaveBeenCalledWith(USER.id, 'v1')
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

  it('files an upload into a named shelf, and only when a library is named too', async () => {
    const form = (fields: Record<string, string>) => {
      const parts = ['--x', 'Content-Disposition: form-data; name="file"; filename="a.epub"', 'Content-Type: application/epub+zip', '', 'PK', ...Object.entries(fields).flatMap(([k, v]) => [`--x`, `Content-Disposition: form-data; name="${k}"`, '', v]), '--x--', '']
      return { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: parts.join('\r\n') }
    }

    // A shelf id is meaningless without a library: an upload with no libraryId
    // lands in the caller's private library, and the private library's
    // uncategorized state is what omitting categoryId already means.
    const filed = await createApp().request('/api/v1/ext/books', form({ libraryId: 'lib1', categoryId: 'cat1' }))
    expect(filed.status).toBe(201)
    expect(uploadCatalogBook).toHaveBeenCalledWith('lib1', USER.id, expect.any(File), expect.objectContaining({ categoryId: 'cat1' }))

    vi.clearAllMocks()
    const uncategorized = await createApp().request('/api/v1/ext/books', form({ categoryId: 'cat1' }))
    expect(uncategorized.status).toBe(201)
    expect(uploadCatalogBook).not.toHaveBeenCalled()
    expect(uploadBook).toHaveBeenCalledWith(USER.id, expect.any(File), undefined, expect.anything())
  })

  it('trashes a version and checks the named library before acting on it', async () => {
    const res = await createApp().request('/api/v1/ext/books/v1?libraryId=lib1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(requireLibraryManager).toHaveBeenCalledWith(USER.id, 'lib1')
    expect(deleteExternalBook).toHaveBeenCalledWith(USER.id, 'v1')
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
})
