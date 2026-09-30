import { eq } from 'drizzle-orm'

import type {
  ExternalBook,
  ExternalBookDetail,
  ExternalBookListRes,
  ExternalCategory,
  ExternalLibrary,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraryBookVersions } from '../../db/schema'
import { AppError } from '../../middleware/error'
import {
  getLibraryVersionPublication,
  listLibraryVersionEntries,
  type LibraryVersionEntry,
} from '../libraries/catalog.service'
import type { LibraryListQuery } from '../libraries/library-query'
import { isLibraryManager } from '../libraries/library-access'
import { listLibraries } from '../libraries/libraries.service'
import { listLibraryCategories } from '../shelves/shelves.service'
import { listLibraryTags } from '../tags/tags.service'
import { listBrowsableLibraries } from '../books/legado.service'
import { getActiveBook, getBookCoverContent, trashBook } from '../books/books.service'
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
 * client has no use for (`progress`, `readStatus`, a single-valued `shelfId`
 * that exists for drag-to-shelf checks), and the second is work-grouped, which
 * is the wrong unit for something whose downloadable atom is a file.
 */

export interface ExternalListParams {
  libraryId?: string
  q?: string
  format?: 'epub' | 'txt'
  sortBy?: string
  sortOrder?: string
  /** Unix ms; see LibraryListQuery.updatedSince. */
  updatedSince?: number
  page: number
  pageSize: number
}

const SORTABLE = new Set(['title', 'createdAt', 'updatedAt', 'size'])

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
 * The uncategorized bucket is absent, and that is not an omission: it is not a
 * row in `library_categories` but a display fiction the book source synthesises
 * for its generated UI. A book with no shelf is `categoryId: null`, which is
 * exactly what omitting the field on upload produces.
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
    const [categories, tags] = await Promise.all([
      listLibraryCategories(userId, library.id),
      listLibraryTags(userId, library.id),
    ])

    // `depth` is derived rather than stored: the tree is cycle-free because the
    // category-parent service refuses cycles, and the walk is bounded anyway so
    // a hand-edited row cannot hang the request.
    const byId = new Map(categories.map((row) => [row.id, row]))
    const shelves: ExternalCategory[] = []
    for (const row of categories) {
      let depth = 0
      let cursor = row.parentId
      while (cursor && depth < 8) {
        depth += 1
        cursor = byId.get(cursor)?.parentId ?? null
      }
      shelves.push({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        depth,
        bookCount: row.bookCount,
        // Coerced because the row types this column boolean while SQLite hands
        // back 0/1, and the contract promises a real boolean.
        hidden: Boolean(row.hidden),
      })
    }

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
      categories: shelves,
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        bookCount: tag.bookCount,
        hidden: Boolean(tag.hidden),
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
    sortBy: SORTABLE.has(params.sortBy ?? '') ? params.sortBy : 'updatedAt',
    sortOrder: params.sortOrder === 'asc' ? 'asc' : 'desc',
    updatedSince: params.updatedSince,
  }
}

/**
 * List across every library the caller can browse, paged globally.
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
  const offset = (params.page - 1) * params.pageSize
  const wanted = offset + params.pageSize

  // Totals are counted across every library before any rows are collected. One
  // library can fill a whole page on its own, and stopping the walk there would
  // report a total that silently excludes every library after it — which reads
  // as "you have reached the end" to a client paging on hasMore.
  const firstPages = await Promise.all(targets.map((library) =>
    listLibraryVersionEntries(userId, library.id, { ...query, page: 1, pageSize: 100 })))
  const total = firstPages.reduce((sum, result) => sum + result.total, 0)

  const collected: Array<{ entry: LibraryVersionEntry; libraryId: string; libraryName: string }> = []
  for (const [index, library] of targets.entries()) {
    const first = firstPages[index]!
    collected.push(...first.items.map((entry) => ({ entry, libraryId: library.id, libraryName: library.name })))
    // A library smaller than one page is exhausted; anything else may have rows
    // this page has not reached yet.
    for (let page = 2; collected.length < wanted && first.total > (page - 1) * 100; page++) {
      const next = await listLibraryVersionEntries(userId, library.id, { ...query, page, pageSize: 100 })
      if (next.items.length === 0) break
      collected.push(...next.items.map((entry) => ({ entry, libraryId: library.id, libraryName: library.name })))
    }
    if (collected.length >= wanted) break
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
export async function getExternalBook(userId: string, versionId: string): Promise<ExternalBookDetail> {
  // getActiveBook is the readability gate and covers both a private card and a
  // library version, including the collected-source check.
  await getActiveBook(userId, versionId, EXT_READ)
  const publication = await getLibraryVersionPublication(userId, versionId)
  if (!publication) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const library = libraryOfVersion(userId, versionId)
  if (!library) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const row = await singleVersionRow(userId, library.id, versionId)
  const cover = await getBookCoverContent(userId, versionId, { size: 'thumb' })
  return {
    ...toExternalBook(row, library.id, library.name),
    title: publication.title,
    description: publication.description,
    bookmeta: publication.bookmeta,
    fileName: publication.fileName,
    cover: cover ? `data:${cover.contentType};base64,${Buffer.from(cover.data).toString('base64')}` : null,
  }
}

/**
 * Move a book to the trash.
 *
 * Deliberately the recoverable delete: the Web owns the trash, so a token can
 * never leave the library in a state its owner cannot undo from the UI.
 * Permanent deletion is not exposed.
 */
export async function deleteExternalBook(userId: string, versionId: string): Promise<{ bookVersionId: string }> {
  // Reading first keeps the failure a clean 404 rather than whatever the write
  // path would raise for a version this caller cannot see. A manager may trash
  // a hidden book, since the listing already showed it to them.
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
  if (!libraryOfVersion(userId, versionId)?.private) {
    throw new AppError('FORBIDDEN', 'Books in a shared library can only be deleted from the web UI by a library manager')
  }
  if (!isTrashEnabled(userId)) throw new AppError('TRASH_DISABLED', 'Trash is disabled')
  await trashBook(userId, versionId)
  return { bookVersionId: versionId }
}

/**
 * Which browsable library a version should be reported under.
 *
 * A `bookVersionId` can be linked into more than one library — the same file in
 * the reader's own vault and in a shared library is one row in the book list per
 * library, but one id — so the lookup is over all its links rather than the first
 * one SQLite happens to return. The reader's own library wins, because that is
 * the copy they own and the one every private-only operation acts on. It also
 * makes this deterministic: an unordered `.get()` would otherwise attribute a
 * version to whichever library the planner reached first, so the same request
 * could name different libraries for the same book.
 *
 * Note the limit this leaves: the detail endpoint is keyed by version, so for a
 * version in several libraries it reports one of them. The list stays exact,
 * because it is paged per library.
 */
function libraryOfVersion(userId: string, versionId: string) {
  const links = getDb().select({ libraryId: libraryBookVersions.libraryId }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.bookVersionId, versionId)).all()
  if (links.length === 0) return undefined
  const browsable = listBrowsableLibraries(userId)
  const held = new Set(links.map((link) => link.libraryId))
  return browsable.find((lib) => lib.private && held.has(lib.id))
    ?? browsable.find((lib) => held.has(lib.id))
}

async function singleVersionRow(userId: string, libraryId: string, versionId: string): Promise<LibraryVersionEntry> {
  const result = await listLibraryVersionEntries(userId, libraryId, { page: 1, pageSize: 100 })
  const found = result.items.find((entry) => entry.bookVersionId === versionId)
  if (!found) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  return found
}
