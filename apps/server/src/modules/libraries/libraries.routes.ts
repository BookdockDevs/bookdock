import { Hono } from 'hono'

import {
  catalogBookUpdateSchema,
  batchOrganizeSchema,
  batchSelectionSchema,
  catalogSimilarQuerySchema,
  catalogUploadSchema,
  catalogVersionMoveSchema,
  catalogVersionUpdateSchema,
  collectBookSchema,
  categoryCreateSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
  libraryCreateSchema,
  libraryJoinSchema,
  libraryInviteTokenSchema,
  libraryUpdateSchema,
  membershipManageSchema,
  membershipRoleSchema,
  ownershipTransferSchema,
  publishPrivateBookSchema,
  tagCreateSchema,
  tagReorderSchema,
  tagUpdateSchema,
} from '@bookdock/shared'

import {
  addMember,
  createLibrary,
  createLibraryInvite,
  deleteLibrary,
  getLibrary,
  getLibraryInviteStatus,
  getRelation,
  joinLibrary,
  joinLibraryByInvite,
  listLibraries,
  listMembers,
  previewLibraryInvite,
  removeMember,
  revokeLibraryInvite,
  setMemberRole,
  setVersionGuestReadable,
  transferLibraryOwnership,
  updateLibrary,
} from './libraries.service'
import {
  deleteCatalogVersion,
  deleteCatalogBook,
  emptyLibraryTrash,
  findSimilarWorks,
  getCatalogBook,
  listCatalogBooks,
  moveCatalogVersion,
  permanentDeleteCatalogBook,
  removeCatalogBookCover,
  removeCatalogVersionCover,
  resetCatalogVersionMetadata,
  restoreCatalogBook,
  updateCatalogBook,
  updateCatalogBookCover,
  updateCatalogVersion,
  updateCatalogVersionCover,
  getCatalogBatchSelection,
  organizeCatalogBatch,
} from './catalog.service'
import { addToPrivateLibrary } from './collect.service'
import { publishPrivateBook } from './publish.service'
import { uploadCatalogBook } from '../books/books.service'
import { AppError } from '../../middleware/error'

import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { isTitleNormalizeEnabled } from '../settings/settings.service'
import {
  createLibraryCategory,
  deleteLibraryCategory,
  listLibraryCategories,
  reorderLibraryCategories,
  setLibraryCategoryParent,
  updateLibraryCategory,
} from '../shelves/shelves.service'
import {
  createLibraryTag,
  deleteLibraryTag,
  listLibraryTags,
  reorderLibraryTags,
  updateLibraryTag,
} from '../tags/tags.service'

const librariesRoutes = new Hono()

librariesRoutes.get('/', async (c) => {
  const user = c.get('user')
  const items = await listLibraries({ userId: user?.id ?? null, isGuest: c.get('guest') === true })
  return c.json({ data: items })
})

librariesRoutes.post('/', async (c) => {
  const user = c.get('user')
  const parsed = libraryCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const library = await createLibrary({ userId: user?.id ?? null, isGuest: c.get('guest') === true }, parsed.data)
  return c.json({ data: library }, 201)
})

librariesRoutes.post('/invites/preview', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') === true) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = libraryInviteTokenSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid invitation' } }, 400)
  return c.json({ data: previewLibraryInvite(user.id, parsed.data.token) })
})

librariesRoutes.post('/invites/join', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') === true) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = libraryInviteTokenSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid invitation' } }, 400)
  return c.json({ data: joinLibraryByInvite(user.id, parsed.data.token) }, 201)
})

librariesRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const library = await getLibrary({ userId: user?.id ?? null, isGuest: c.get('guest') === true }, c.req.param('id'))
  return c.json({ data: library })
})

librariesRoutes.get('/:id/relation', async (c) => {
  const user = c.get('user')
  const result = await getRelation({ userId: user?.id ?? null, isGuest: c.get('guest') === true }, c.req.param('id'))
  return c.json({ data: result })
})

librariesRoutes.post('/:id/join', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = libraryJoinSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await joinLibrary(user.id, c.req.param('id'), parsed.data.accessPassword)
  return c.json({ data: result }, 201)
})

librariesRoutes.get('/:id/invite', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') === true) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: getLibraryInviteStatus(user.id, c.req.param('id')) })
})

librariesRoutes.post('/:id/invite', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') === true) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: createLibraryInvite(user.id, c.req.param('id')) }, 201)
})

librariesRoutes.delete('/:id/invite', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') === true) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: revokeLibraryInvite(user.id, c.req.param('id')) })
})

librariesRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = libraryUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const library = await updateLibrary(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: library })
})

librariesRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await deleteLibrary(user.id, c.req.param('id'))
  return c.json({ data: result })
})

librariesRoutes.post('/:id/transfer', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = ownershipTransferSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const library = await transferLibraryOwnership(user.id, c.req.param('id'), parsed.data.userId)
  return c.json({ data: library })
})

librariesRoutes.get('/:id/members', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await listMembers(user.id, c.req.param('id'))
  return c.json({ data: result })
})

librariesRoutes.post('/:id/members', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = membershipManageSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const member = await addMember(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: member }, 201)
})

librariesRoutes.patch('/:id/members/:userId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = membershipRoleSchema.safeParse((await c.req.json() as { role?: unknown }).role)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const member = await setMemberRole(user.id, c.req.param('id'), c.req.param('userId'), parsed.data)
  return c.json({ data: member })
})

librariesRoutes.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await removeMember(user.id, c.req.param('id'), c.req.param('userId'))
  return c.json({ data: result })
})

librariesRoutes.patch('/:id/versions/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json().catch(() => ({})) as { guestReadable?: unknown }
  if (typeof body.guestReadable !== 'boolean') {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: 'guestReadable is required' } }, 400)
  }
  const result = await setVersionGuestReadable(user.id, c.req.param('id'), c.req.param('versionId'), body.guestReadable)
  return c.json({ data: result })
})

// ------------------------------------------------------------- Catalog (5.x)

librariesRoutes.get('/:id/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const page = Number(c.req.query('page') ?? '1')
  const pageSize = Number(c.req.query('pageSize') ?? '')
  const format = c.req.query('format')
  // Same query vocabulary as GET /books, so one library list and the other can
  // share a single UI without the two drifting apart. Reading-state dimensions
  // (read status, progress, last-read) are deliberately absent: they belong to
  // books someone owns, and a catalog has none.
  const result = await listCatalogBooks(user.id, c.req.param('id'), {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    search: c.req.query('q') ?? undefined,
    sortBy: c.req.query('sortBy') ?? undefined,
    sortOrder: c.req.query('sortOrder') ?? undefined,
    categoryId: c.req.query('categoryId') ?? c.req.query('shelfId') ?? undefined,
    tagId: c.req.query('tagId') ?? undefined,
    format: format === 'epub' || format === 'txt' ? format : undefined,
    author: c.req.query('author') ?? undefined,
    series: c.req.query('series') ?? undefined,
    trash: c.req.query('trash') === '1',
  })
  return c.json({ data: result })
})

// Must be registered before `/books/:bookId`: Hono matches parameter routes in
// registration order, so `/books/similar` would be read as a book id otherwise.
librariesRoutes.get('/:id/books/similar', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = catalogSimilarQuerySchema.safeParse({
    title: c.req.query('title'),
    author: c.req.query('author') ?? undefined,
    excludeLibraryBookId: c.req.query('excludeLibraryBookId') ?? undefined,
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const items = await findSimilarWorks(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: items })
})

librariesRoutes.get('/:id/books/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const book = await getCatalogBook(user.id, c.req.param('id'), c.req.param('bookId'))
  return c.json({ data: book })
})

librariesRoutes.post('/:id/books/from-private', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = publishPrivateBookSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await publishPrivateBook(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: result }, result.duplicated ? 200 : 201)
})

librariesRoutes.post('/:id/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const libraryId = c.req.param('id')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  if (file.size > effectiveUploadMaxBytes()) {
    return c.json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } }, 413)
  }
  let rawTagIds: unknown
  if (body['tagIds'] !== undefined) {
    try {
      rawTagIds = JSON.parse(String(body['tagIds']))
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tagIds' } }, 400)
    }
  }
  const parsed = catalogUploadSchema.safeParse({
    libraryBookId: body['libraryBookId'],
    categoryId: body['categoryId'],
    name: body['name'],
    title: body['title'],
    author: body['author'],
    tagIds: rawTagIds,
  })
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await uploadCatalogBook(libraryId, user.id, file, {
    ...parsed.data,
    normalizeTitle: isTitleNormalizeEnabled(user.id),
  })
  const book = await getCatalogBook(user.id, libraryId, result.libraryBookId)
  // The new link id lets uploaders select the version they just added without
  // re-listing; duplicates carry no new link.
  return c.json({
    data: book,
    duplicated: result.duplicated,
    versionLinkId: result.duplicated ? undefined : result.versionLinkId,
  }, 201)
})

librariesRoutes.post('/:id/books/batch/selection', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  const parsed = batchSelectionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid selection', parsed.error.flatten())
  return c.json({ data: await getCatalogBatchSelection(user.id, c.req.param('id'), parsed.data.ids) })
})

librariesRoutes.patch('/:id/books/batch/organize', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  const parsed = batchOrganizeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid batch organization', parsed.error.flatten())
  return c.json({ data: await organizeCatalogBatch(user.id, c.req.param('id'), parsed.data) })
})

librariesRoutes.delete('/:id/books/:bookId', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  return c.json({ data: await deleteCatalogBook(user.id, c.req.param('id'), c.req.param('bookId')) })
})

librariesRoutes.post('/:id/books/:bookId/restore', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  return c.json({ data: await restoreCatalogBook(user.id, c.req.param('id'), c.req.param('bookId')) })
})

librariesRoutes.delete('/:id/books/:bookId/permanent', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  return c.json({ data: await permanentDeleteCatalogBook(user.id, c.req.param('id'), c.req.param('bookId')) })
})

librariesRoutes.delete('/:id/trash', async (c) => {
  const user = c.get('user')
  if (!user || user.role === 'guest') throw new AppError('FORBIDDEN')
  return c.json({ data: await emptyLibraryTrash(user.id, c.req.param('id')) })
})

librariesRoutes.patch('/:id/books/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = catalogBookUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Object.values(parsed.success ? parsed.data : {}).every((v) => v === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'empty patch' : parsed.error.flatten() } }, 400)
  }
  const book = await updateCatalogBook(user.id, c.req.param('id'), c.req.param('bookId'), parsed.data)
  return c.json({ data: book })
})

librariesRoutes.put('/:id/books/:bookId/cover', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', 'File is required')
  }
  const book = await updateCatalogBookCover(user.id, c.req.param('id'), c.req.param('bookId'), file)
  return c.json({ data: book })
})

librariesRoutes.delete('/:id/books/:bookId/cover', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const book = await removeCatalogBookCover(user.id, c.req.param('id'), c.req.param('bookId'))
  return c.json({ data: book })
})

librariesRoutes.patch('/:id/books/:bookId/versions/:versionLinkId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = catalogVersionUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Object.values(parsed.success ? parsed.data : {}).every((v) => v === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'empty patch' : parsed.error.flatten() } }, 400)
  }
  const version = await updateCatalogVersion(
    user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'), parsed.data,
  )
  return c.json({ data: version })
})

librariesRoutes.patch('/:id/books/:bookId/versions/:versionLinkId/move', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = catalogVersionMoveSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const book = await moveCatalogVersion(
    user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'), parsed.data.libraryBookId,
  )
  return c.json({ data: book })
})

librariesRoutes.delete('/:id/books/:bookId/versions/:versionLinkId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await deleteCatalogVersion(user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'))
  return c.json({ data: result })
})

librariesRoutes.put('/:id/books/:bookId/versions/:versionLinkId/cover', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', 'File is required')
  }
  const version = await updateCatalogVersionCover(
    user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'), file,
  )
  return c.json({ data: version })
})

librariesRoutes.delete('/:id/books/:bookId/versions/:versionLinkId/cover', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const version = await removeCatalogVersionCover(user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'))
  return c.json({ data: version })
})

librariesRoutes.post('/:id/books/:bookId/versions/:versionLinkId/reset-metadata', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const book = await resetCatalogVersionMetadata(user.id, c.req.param('id'), c.req.param('bookId'), c.req.param('versionLinkId'))
  return c.json({ data: book })
})

// -------------------------------------------------------------- Collect (7.x)

/**
 * Add-to-private. Registration order matters again: this static segment must
 * come before `/books/:bookId/versions/:versionLinkId/...` patterns that could
 * swallow "collect".
 */
librariesRoutes.post('/:id/versions/:versionLinkId/collect', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = collectBookSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const result = await addToPrivateLibrary(user.id, c.req.param('id'), c.req.param('versionLinkId'), parsed.data)
  return c.json({ data: result }, result.alreadyExists ? 200 : 201)
})

librariesRoutes.get('/:id/categories', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const items = await listLibraryCategories(user.id, c.req.param('id'))
  return c.json({ data: items })
})

librariesRoutes.post('/:id/categories', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = categoryCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const category = await createLibraryCategory(user.id, c.req.param('id'), parsed.data)
  return c.json({ data: category }, 201)
})

librariesRoutes.patch('/:id/categories/:categoryId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = categoryUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.parentId === undefined && parsed.data.pinned === undefined && parsed.data.hidden === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'name, parentId, pinned or hidden is required' : parsed.error.flatten() } }, 400)
  }
  const { parentId, ...rest } = parsed.data
  const renamed = await updateLibraryCategory(user.id, c.req.param('id'), c.req.param('categoryId'), rest)
  const moved = parentId !== undefined
    ? await setLibraryCategoryParent(user.id, c.req.param('id'), c.req.param('categoryId'), parentId)
    : renamed
  return c.json({ data: moved })
})

librariesRoutes.put('/:id/categories/order', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = categoryReorderSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reorderLibraryCategories(user.id, c.req.param('id'), parsed.data.categoryIds)
  return c.json({ data: null })
})

librariesRoutes.delete('/:id/categories/:categoryId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await deleteLibraryCategory(user.id, c.req.param('id'), c.req.param('categoryId'))
  return c.json({ data: result })
})

librariesRoutes.get('/:id/tags', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const items = await listLibraryTags(user.id, c.req.param('id'))
  return c.json({ data: items })
})

librariesRoutes.post('/:id/tags', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagCreateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const tag = await createLibraryTag(user.id, c.req.param('id'), parsed.data.name)
  return c.json({ data: tag }, 201)
})

librariesRoutes.patch('/:id/tags/:tagId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.pinned === undefined && parsed.data.hidden === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'name, pinned or hidden is required' : parsed.error.flatten() } }, 400)
  }
  const tag = await updateLibraryTag(user.id, c.req.param('id'), c.req.param('tagId'), parsed.data)
  return c.json({ data: tag })
})

librariesRoutes.put('/:id/tags/order', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagReorderSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reorderLibraryTags(user.id, c.req.param('id'), parsed.data.tagIds)
  return c.json({ data: null })
})

librariesRoutes.delete('/:id/tags/:tagId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await deleteLibraryTag(user.id, c.req.param('id'), c.req.param('tagId'))
  return c.json({ data: result })
})

export default librariesRoutes
