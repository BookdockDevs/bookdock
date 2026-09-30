import type { BookFormat } from './constants'
import type { BookMetadata } from './contract'

/**
 * Wire shapes for the external `/api/v1/ext` surface.
 *
 * This is a separate contract from the Web API on purpose. `/api/v1/books`
 * returns a sidebar projection - `readStatus`, `progress`, `pinnedAt` and a
 * single-valued `shelfId` that exists to make drag-to-shelf no-op checks work.
 * An external sync client cannot tell those apart from real domain fields, and
 * would break every time the Web UI changed shape, so the two never share a DTO.
 *
 * The surface is deliberately narrow: read information, upload, download, and
 * move to trash. Chapter bodies, TOCs, reading progress, taxonomy editing,
 * version management and library administration all stay in the Web, which is
 * where they have real workflows behind them.
 *
 * Download is likewise one representation, not the Web's four. The Web's export
 * pair is TXT-only, and its 校订版 form is regenerated per caller from that
 * user's text-replacement rules — one URL, different bytes per user — which is
 * not something a row advertising `size` and `updatedAt` can honestly promise.
 * So `GET /books/:bookVersionId/file` always returns the stored blob as
 * `application/epub+zip`, and `sourceFormat` records what was uploaded.
 *
 * Taxonomy is present only as far as placing an upload needs it: each library row
 * carries its whole shelf tree and tag list, and an upload may name a category.
 * Creating, renaming and deleting either stays in the Web.
 */

/**
 * One shelf in a library, with the work count the caller would see.
 *
 * Called `category` because that is the column, the table and the id the upload
 * takes. The Web labels the private library's shelves 书架 and a shared library's
 * 分类, but they are one taxonomy in one id space — the migration that created
 * the library model reused the old shelf ids as category ids.
 */
export interface ExternalCategory {
  id: string
  name: string
  /** `null` for a top-level shelf. */
  parentId: string | null
  /**
   * Nesting level from the tree root, so a client can indent without walking
   * `parentId` itself. The tree is cycle-free by construction, and the server
   * bounds the walk anyway so a malformed row cannot hang the request.
   */
  depth: number
  /** Works filed here, counting only what this caller is allowed to see. */
  bookCount: number
  /**
   * Hidden shelves are a member-facing switch, so a manager receives them and a
   * member never does. Carried because the row can arrive at all.
   */
  hidden: boolean
}

export interface ExternalTag {
  id: string
  name: string
  bookCount: number
  hidden: boolean
}

/** One library the caller can browse, with what they are allowed to do to it. */
export interface ExternalLibrary {
  id: string
  name: string
  type: 'private' | 'shared'
  role: 'owner' | 'admin' | 'member'
  /**
   * Whether upload and delete will be accepted here. Carried on the row so a
   * client does not have to discover it by collecting a 403, and so a library
   * the caller can only read is visibly different from one they manage.
   */
  canWrite: boolean
  /** The owner plus every member; a private library is always just its owner. */
  memberCount: number
  /**
   * Works, not files. A work with three editions is one work and three rows in
   * the book list, so this is not a page count to page against — it is there to
   * tell an empty library from a populated one.
   */
  workCount: number
  /**
   * The whole taxonomy travels with the row rather than behind its own endpoint.
   * A client that mirrors a folder structure needs every shelf id before it can
   * file its first upload, and the library list is small enough that a second
   * round trip per library would be the only expensive part of a sync. It is
   * read through the same two functions the Web sidebar uses, so these counts
   * and the hide rules are the ones the caller's own browser would show.
   */
  categories: ExternalCategory[]
  tags: ExternalTag[]
}

/**
 * One book, one row per version.
 *
 * A downloadable thing is a version, not a work: a work with three editions is
 * three files and the client may want any of them. Keyed by `bookVersionId`
 * because that is the only id every other endpoint in this surface accepts, and
 * because the same underlying file linked into two libraries is one thing to
 * sync rather than two rows that look like a duplicate.
 */
export interface ExternalBook {
  bookVersionId: string
  libraryId: string
  libraryName: string
  title: string
  author: string
  authors: string[]
  /** Uploader-supplied edition label; empty when the version is unnamed. */
  versionName: string
  /**
   * The format the book was uploaded as. Named `sourceFormat` because it does
   * *not* describe what a download returns: **the download is always
   * `application/epub+zip`**.
   *
   * - An uploaded EPUB comes back byte-identical to what was stored.
   * - A TXT book is served the EPUB the server derived from its normalized
   *   text. The original `.txt` bytes are never stored, so there is nothing to
   *   hand back — the closest thing to the original is the unreplaced
   *   normalized text, which the Web's export produces and this surface
   *   deliberately does not.
   *
   * A client mirroring this library stores EPUB files either way, and should
   * name them from this field's source rather than from the bytes it receives.
   */
  sourceFormat: BookFormat
  /** Bytes the download will return, which is the stored blob's size. */
  size: number
  /**
   * Whether a cover exists. The row carries no cover bytes and no blob key,
   * because a client cannot resolve a key here — the image is inlined in the
   * detail response instead.
   */
  hasCover: boolean
  categoryName: string | null
  tags: string[]
  /**
   * The work is hidden in its library. Only ever true for a manager: the
   * listing skips the hide filter for them, so a listed row has to say so — the
   * Web badges hidden rows for the same reason. A member never receives one.
   */
  hidden: boolean
  wordCount: number | null
  /**
   * Unix ms. A syncing client keeps the highest value it has seen and passes it
   * back as `updatedSince`, which is what makes an incremental sync possible
   * without fetching the whole library every run.
   */
  createdAt: number
  updatedAt: number
}

/**
 * Detail adds what a list must not carry: publication metadata and a
 * description are heavy enough that inlining them per row would put a list
 * response into the megabytes, and the cover is a base64 data URI.
 */
export interface ExternalBookDetail extends ExternalBook {
  description: string
  /** Version over work over parsed-file publication metadata. */
  bookmeta: BookMetadata
  /**
   * Original uploaded file name, surviving later title edits. Recorded for
   * provenance, not as a download template: a TXT upload keeps its `.txt` name
   * here while `GET /books/:bookVersionId/file` hands back an EPUB, so name the
   * saved file from the download's own `Content-Disposition`.
   */
  fileName: string | null
  /**
   * Cover thumbnail as a `data:` URI, or null when the book has no cover. Only
   * the thumbnail: a client displays this, it does not archive it, and the
   * full-size original stays in the Web.
   */
  cover: string | null
}

export interface ExternalBookListRes {
  items: ExternalBook[]
  total: number
  page: number
  pageSize: number
  /**
   * Whether another page follows. Cheaper than comparing against `total` for a
   * client that is deleting as it syncs, where the total drifts mid-run and
   * `total` would send it through a pointless empty page.
   */
  hasMore: boolean
}

export interface ExternalLibrariesRes {
  libraries: ExternalLibrary[]
}

export interface ExternalUploadRes {
  bookVersionId: string
  title: string
  author: string
  /** As on ExternalBook: what was uploaded, not what a download returns. */
  sourceFormat: BookFormat
  size: number
  /**
   * The server already held this exact file, so nothing new was added. A client
   * that re-runs the same folder cannot otherwise tell "I added a book" from
   * "that was already there", which is the difference between an idempotent
   * sync and one that keeps reporting phantom changes.
   */
  duplicated: boolean
}
