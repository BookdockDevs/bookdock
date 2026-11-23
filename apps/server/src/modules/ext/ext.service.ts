import { and, eq, isNull } from 'drizzle-orm'

import { bookUpdateSchema } from '@bookdock/shared'

import type {
  Category,
  ExternalBook,
  ExternalBookDetail,
  ExternalBookListRes,
  ExternalCategory,
  ExternalLibrary,
  ExternalListParams,
  ExternalWorkPatch,
  ShelfListItem,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions } from '../../db/schema'
import { AppError } from '../../middleware/error'
import {
  listLibraryVersionEntries,
  updateCatalogBookByVersion,
  type LibraryVersionEntry,
} from '../libraries/catalog.service'
import type { LibraryListQuery } from '../libraries/library-query'
import { isLibraryManager } from '../libraries/library-access'
import { listLibraries } from '../libraries/libraries.service'
import { listShelves } from '../shelves/shelves.service'
import { listCategoryValues, listTagValues } from '../classification/classification.service'
import { listBrowsableLibraries } from '../books/legado.service'
import { getActiveBook, getBookCoverContent, getBookCoverContentByKey, resolveLibraryBook, savePrivateBook, trashBook } from '../books/books.service'
import { isTrashEnabled } from '../settings/settings.service'

/**
 * The external surface's only job is projecting the library model into a
 * contract an automation client can depend on.
 *
 * Every decision about *what* a caller may see stays in the domain layer —
 * `assertLibraryBrowsable` and the manager/hidden rules inside
 * `listLibraryVersionEntries`, `requireLibraryManager` for writes. This file
 * only decides which fields cross the wire and what they are called.
 *
 * It reuses the book source's version-per-row projection rather than
 * `listBooks` or `listCatalogBooks`: the first carries per-user reading state a
 * client has no use for (`progress` and `readStatus`), and the second is
 * work-grouped, which is the wrong unit for something whose downloadable atom
 * is a file.
 */

/**
 * A private library is a vault, so its owner also hides rows by default and
 * every casual read refuses them as NOT_FOUND. This surface lists them anyway:
 * `listLibraryVersionEntries` skips the hide filter for a manager, and the
 * reader's own library makes them its manager. So a listed row must be openable
 * — otherwise the list advertises a book that 404s on detail and download,
 * which is the same trap the book source avoids with its own `LEGADO_READ`.
 *
 * The flag relaxes only the hide filter; deletion and the collected-source
 * check stay in force.
 */
export const EXT_READ = { showHidden: true } as const

/**
 * Every library the caller can browse, each carrying what a client needs before
 * it can place a single upload: its head counts and its whole taxonomy.
 *
 * All three reads are the Web's own. `listLibraries` already batches member and
 * work counts across every row with the role-aware rule (a member's count skips
 * hidden and all-unlisted works, so it matches the catalog they are about to
 * open), and the two taxonomy reads are the sidebar's, with the same rule and
 * counts batched per library rather than per row. Writing parallel queries here
 * would be a second place for the hide rules to drift.
 *
 * Shelves and categories have separate IDs and are projected separately. The
 * uncategorized bucket is absent because it is a display fiction, not a row.
 */
export async function listExternalLibraries(userId: string): Promise<ExternalLibrary[]> {
  const browsable = listBrowsableLibraries(userId)
  if (browsable.length === 0) return []
  // listLibraries also returns public libraries this user never joined, so it is
  // read for its counts only and the browsable set decides which rows survive —
  // the same rule the book list below applies, so the two cannot disagree.
  const counts = new Map((await listLibraries({ userId, isGuest: false })).map((row) => [row.id, row]))

  return Promise.all(browsable.map(async (library) => {
    // canWrite answers "will an upload or delete be accepted here" without
    // making the client find out by collecting a 403 on its first write.
    const canWrite = await isLibraryManager(userId, library.id)
    const [categories, libraryShelves, tags] = await Promise.all([
      listCategoryValues(userId, library.id, { showHidden: true }),
      library.private ? listShelves(userId, true) : Promise.resolve([]),
      listTagValues(userId, library.id, { showHidden: true }),
    ])

    // Categories carry their own path, so the indent and the parent key are
    // read off the value instead of walking a tree of rows.
    const projectCategories = (rows: Category[]): ExternalCategory[] => rows.map((node) => ({
      id: node.id,
      path: node.path,
      name: node.name,
      parentId: node.parentId,
      depth: node.path.length - 1,
      bookCount: node.bookCount,
      hidden: node.hidden,
    }))
    // A shelf is still an entity: flat, with a row id and no path.
    const projectShelves = (rows: ShelfListItem[]): ExternalCategory[] => rows.map((row) => ({
      id: row.id,
      path: null,
      name: row.name,
      parentId: null,
      depth: 0,
      bookCount: row.bookCount,
      hidden: Boolean(row.hidden),
    }))

    const row = counts.get(library.id)
    return {
      id: library.id,
      name: library.name,
      type: library.type,
      // The private library's owner is its own manager; a joined shared library
      // reports owner or member, which is all a client branches on.
      role: library.private ? 'owner' as const : library.type === 'shared' && canWrite ? 'admin' as const : 'member' as const,
      canWrite,
      memberCount: row?.memberCount ?? 1,
      workCount: row?.workCount ?? 0,
      categories: projectCategories(categories),
      shelves: projectShelves(libraryShelves),
      tags: tags.map((tag) => ({
        id: tag.name,
        name: tag.name,
        bookCount: tag.bookCount,
        hidden: tag.hidden,
      })),
    }
  }))
}

function toExternalBook(entry: LibraryVersionEntry, libraryId: string, libraryName: string): ExternalBook {
  return {
    bookVersionId: entry.bookVersionId,
    libraryId,
    libraryName,
    title: entry.title,
    author: entry.author,
    authors: entry.authors,
    versionName: entry.versionName,
    // Named sourceFormat because the download is always EPUB: an uploaded EPUB
    // comes back as stored, and a TXT book is served the EPUB the server derived
    // from its normalized text, since the original .txt bytes are never kept.
    sourceFormat: entry.format,
    size: entry.size,
    hasCover: Boolean(entry.coverKey),
    categoryName: entry.categoryName,
    shelfName: entry.shelfName,
    tags: entry.tags,
    // A manager sees the vault's hidden rows, so the row has to say which ones
    // they are — the Web badges them for the same reason. A member never
    // receives a hidden row at all, so for them this is always false.
    // Coerced because the projection types this column boolean while SQLite
    // hands back 0/1, and the contract promises a real boolean.
    hidden: Boolean(entry.hidden),
    wordCount: entry.wordCount,
    createdAt: entry.createdAt,
    // The newer of the two, so the watermark a client stores from this field is
    // exactly the one `updatedSince` filters on.
    updatedAt: Math.max(entry.updatedAt, entry.contentUpdatedAt),
  }
}

function queryFor(params: ExternalListParams): Partial<LibraryListQuery> {
  return {
    search: params.q,
    format: params.format,
    author: params.author,
    category: params.categoryPath,
    shelfId: params.shelfId,
    tag: params.tag,
    sortBy: params.sortBy ?? 'updatedAt',
    sortOrder: params.sortOrder === 'asc' ? 'asc' : 'desc',
    updatedSince: params.updatedSince,
  }
}

/**
 * Page across the browsable libraries. By default each library keeps its own
 * sorting. For global ordering, only each library's leading rows up to the
 * requested window can contribute to that window.
 *
 * `listLibraryVersionEntries` pages inside one library, so a global window has
 * to be assembled by walking the libraries in their fixed order and slicing
 * once. Doing it correctly costs O(offset) queries for a deep page, which is the
 * right trade here: a syncing client walks pages from 1 and needs every row
 * exactly once, whereas serving a deep random page cheaply would mean silently
 * dropping rows from the second library onward.
 */
export async function listExternalBooks(userId: string, params: ExternalListParams): Promise<ExternalBookListRes> {
  const browsable = listBrowsableLibraries(userId)
  // An explicit libraryId narrows the set instead of replacing it, so pointing
  // it at a library the caller cannot browse yields an empty page rather than
  // an error that would confirm the library exists.
  const targets = params.libraryId ? browsable.filter((lib) => lib.id === params.libraryId) : browsable

  const query = queryFor(params)
  const globalSort = params.sortScope === 'global'
  const options = { globalSort, matchEdition: true }
  const offset = (params.page - 1) * params.pageSize
  const wanted = offset + params.pageSize

  // Totals are counted across every library before any rows are collected. One
  // library can fill a whole page on its own, and stopping the walk there would
  // report a total that silently excludes every library after it — which reads
  // as "you have reached the end" to a client paging on hasMore.
  const firstPages = await Promise.all(targets.map((library) =>
    listLibraryVersionEntries(userId, library.id, { ...query, page: 1, pageSize: 100 }, options)))
  const total = firstPages.reduce((sum, result) => sum + result.total, 0)

  const collected: Array<{ entry: LibraryVersionEntry; libraryId: string; libraryName: string }> = []
  for (const [index, library] of targets.entries()) {
    const first = firstPages[index]!
    collected.push(...first.items.map((entry) => ({ entry, libraryId: library.id, libraryName: library.name })))
    // A library smaller than one page is exhausted; anything else may have rows
    // this page has not reached yet.
    for (let page = 2; (globalSort ? (page - 1) * 100 : collected.length) < wanted && first.total > (page - 1) * 100; page++) {
      const next = await listLibraryVersionEntries(userId, library.id, { ...query, page, pageSize: 100 }, options)
      if (next.items.length === 0) break
      collected.push(...next.items.map((entry) => ({ entry, libraryId: library.id, libraryName: library.name })))
    }
    if (!globalSort && collected.length >= wanted) break
  }
  if (globalSort) {
    const sortBy = params.sortBy ?? 'updatedAt'
    const direction = params.sortOrder === 'asc' ? 1 : -1
    const compareText = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b))
    collected.sort((a, b) => {
      const left = a.entry
      const right = b.entry
      const order = sortBy === 'title' ? compareText(left.title, right.title)
        : sortBy === 'updatedAt' ? Math.max(left.updatedAt, left.contentUpdatedAt) - Math.max(right.updatedAt, right.contentUpdatedAt)
        : left[sortBy] - right[sortBy]
      return order * direction || compareText(left.libraryBookId, right.libraryBookId)
        || compareText(left.bookVersionId, right.bookVersionId) || compareText(a.libraryId, b.libraryId)
    })
  }

  return {
    items: collected.slice(offset, offset + params.pageSize)
      .map(({ entry, libraryId, libraryName }) => toExternalBook(entry, libraryId, libraryName)),
    total,
    page: params.page,
    pageSize: params.pageSize,
    hasMore: offset + params.pageSize < total,
  }
}

/**
 * One row's detail, with the cover inlined.
 *
 * The thumbnail travels as a `data:` URI because the client displays it and a
 * display needs no second round trip. Only the thumbnail: a client is not
 * archiving artwork, and the full-size original stays a Web concern.
 */
export async function getExternalBook(userId: string, versionId: string, libraryId?: string): Promise<ExternalBookDetail> {
  for (const library of librariesOfVersion(userId, versionId)) {
    if (libraryId && library.id !== libraryId) continue
    const { items: [row] } = await listLibraryVersionEntries(userId, library.id, { pageSize: 1 }, { bookVersionId: versionId })
    if (!row) continue
    if (library.private) {
      try {
        await getActiveBook(userId, versionId, EXT_READ)
      } catch (error) {
        // A collected card may lose its source while another library still
        // gives the reader access to this version.
        if (!libraryId && error instanceof AppError && error.code === 'BOOK_NOT_FOUND') continue
        throw error
      }
    }
    const cover = library.private
      ? await getBookCoverContent(userId, versionId, { size: 'thumb' })
      : row.coverKey ? await getBookCoverContentByKey(row.coverKey) : null
    return {
      ...toExternalBook(row, library.id, library.name),
      description: row.description,
      bookmeta: row.bookmeta,
      fileName: row.fileName,
      cover: cover ? `data:${cover.contentType};base64,${cover.data.toString('base64')}` : null,
    }
  }
  throw new AppError('BOOK_NOT_FOUND', 'Book not found')
}

export async function updateExternalBook(userId: string, libraryId: string, versionId: string, patch: ExternalWorkPatch) {
  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries).where(and(
    eq(libraries.id, libraryId), eq(libraries.userId, userId), eq(libraries.type, 'private'),
  )).get()
  if (!privateLibrary) return updateCatalogBookByVersion(userId, libraryId, versionId, patch)

  const { libraryBookId } = resolveLibraryBook(userId, versionId)
  const work = db.select({ id: libraryBooks.id }).from(libraryBooks).where(and(
    eq(libraryBooks.id, libraryBookId), eq(libraryBooks.libraryId, libraryId), isNull(libraryBooks.deletedAt),
  )).get()
  if (!work) throw new AppError('BOOK_NOT_FOUND')

  const description = bookUpdateSchema.shape.descriptionOverride.safeParse(patch.description)
  if (!description.success) throw new AppError('VALIDATION_ERROR', 'Invalid private book description', description.error.flatten())
  await savePrivateBook(userId, versionId, {
    book: { title: patch.title, author: patch.author, authors: patch.authors, descriptionOverride: description.data },
    organization: { categoryPath: patch.categoryPath, tags: patch.tags, shelfId: patch.shelfId },
  })
  return { libraryId, bookVersionId: versionId, libraryBookId }
}

/**
 * Move a book to the trash.
 *
 * Deliberately the recoverable delete: the Web owns the trash, so a token can
 * never leave the library in a state its owner cannot undo from the UI.
 * Permanent deletion is not exposed.
 */
export async function deleteExternalBook(userId: string, versionId: string, libraryId?: string): Promise<{ bookVersionId: string }> {
  // Keep inaccessible versions as 404, including when no library was named.
  await getActiveBook(userId, versionId, EXT_READ)
  // trashBook is the recoverable delete, and it clears deletedAt on the
  // library_books row — which for a shared library is the shared work itself, so
  // calling it there would remove the book for every reader of that library. It
  // is hard-scoped to the caller's own private library for that reason, and the
  // Web deletes inside a shared library through a different, *permanent* path
  // that only a manager can reach. That path stays out of a token's reach on
  // purpose: a client must not be able to leave a library in a state its owner
  // cannot undo from the UI.
  //
  // So this is refused explicitly. Left to the private-only lookup it would
  // surface as BOOK_NOT_FOUND for a row the caller can plainly list and open,
  // which reads as "no such book" rather than "you may not delete this".
  const library = librariesOfVersion(userId, versionId).find((candidate) => !libraryId || candidate.id === libraryId)
  if (!library && libraryId) throw new AppError('BOOK_NOT_FOUND', 'Book not found in the requested library')
  if (!library?.private) {
    throw new AppError('FORBIDDEN', 'Books in a shared library can only be deleted from the web UI by a library manager')
  }
  const { items } = await listLibraryVersionEntries(userId, library.id, { pageSize: 1 }, { bookVersionId: versionId })
  if (items.length === 0) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  if (!isTrashEnabled(userId)) throw new AppError('TRASH_DISABLED', 'Trash is disabled')
  await trashBook(userId, versionId)
  return { bookVersionId: versionId }
}

/**
 * Detail without a library uses the first visible link, preferring the
 * caller's private copy. An explicit library constrains the lookup.
 */
function librariesOfVersion(userId: string, versionId: string) {
  const links = getDb().select({ libraryId: libraryBookVersions.libraryId }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.bookVersionId, versionId)).all()
  if (links.length === 0) return []
  const browsable = listBrowsableLibraries(userId)
  const held = new Set(links.map((link) => link.libraryId))
  return browsable.filter((lib) => held.has(lib.id)).sort((a, b) => Number(b.private) - Number(a.private))
}
