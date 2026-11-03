import { createHash } from 'node:crypto'

import type { ImportBook, ImportNote, ImportProposal } from './reading-imports.service'
import { lookupArchiveEntry, normalizeReaderEntryPath, openEpubArchive, readArchiveEntryBuffer } from '../../formats/epub-index'

// Legado backup entries are root-level JSON arrays (Gson, UTF-8, no HTML
// escaping). Units verified from legado-E source: ReadRecord.readTime is
// milliseconds; Bookmark.time is an epoch-millisecond primary key; there are
// no per-day duration facts anywhere in a legado backup. Bookmark maps by
// verified source semantics: bookText = the saved passage, content = an
// attached note (content present → idea, absent → highlight).
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_RECORDS = 200000
/** Same plausibility ceiling as the WeRead importer: no single book holds more
 * than 2000h of cumulative reading, so a larger value means the unit or the
 * field is not what the record format promises. */
const MAX_BOOK_SECONDS = 2000 * 3600

type Unprocessable = { reason: string; count: number }

function workKey(name: string, author: string): string {
  return `${name}::${author}`
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object') : []
}

async function readJsonArray(buffer: Buffer, fileName: string, bump: (reason: string) => void): Promise<Record<string, unknown>[]> {
  const archive = await openEpubArchive({ size: buffer.length, read: async (start, endInclusive) => buffer.subarray(start, endInclusive + 1) })
  const entry = lookupArchiveEntry(archive, fileName)
  if (!entry) return []
  const data = await readArchiveEntryBuffer(archive, entry, MAX_ENTRY_BYTES)
  const parsed: unknown = JSON.parse(data.toString('utf8'))
  if (!Array.isArray(parsed)) { bump(`${fileName}-not-array`); return [] }
  return rows(parsed)
}

export async function parseLegadoBackup(buffer: Buffer): Promise<ImportProposal> {
  const archive = await openEpubArchive({ size: buffer.length, read: async (start, endInclusive) => buffer.subarray(start, endInclusive + 1) })
  const present = new Set(archive.entries.map((entry) => normalizeReaderEntryPath(entry.path) ?? ''))
  const unprocessable: Unprocessable[] = []
  const bump = (reason: string) => {
    const found = unprocessable.find((item) => item.reason === reason)
    if (found) found.count++
    else unprocessable.push({ reason, count: 1 })
  }
  const readRows = async (fileName: string): Promise<Record<string, unknown>[]> => {
    if (!present.has(fileName)) return []
    try {
      return await readJsonArray(buffer, fileName, bump)
    } catch {
      bump(`${fileName}-unreadable`)
      return []
    }
  }

  const bookRows = await readRows('bookshelf.json')
  const bookmarkRows = await readRows('bookmark.json')
  const recordRows = await readRows('readRecord.json')

  const books = new Map<string, ImportBook>()
  const addBook = (name: string, author: string, extra?: Partial<ImportBook>) => {
    const key = workKey(name, author)
    if (!name || books.has(key)) return key
    books.set(key, {
      sourceBookId: key,
      title: name.slice(0, 2000),
      author: author.slice(0, 2000),
      coverUrl: extra?.coverUrl ?? null,
      finished: null,
      meta: extra?.meta ?? {},
    })
    return key
  }

  for (const row of bookRows) {
    const name = typeof row.name === 'string' ? row.name.slice(0, 2000) : ''
    if (!name) { bump('book-invalid'); continue }
    const author = typeof row.author === 'string' ? row.author.slice(0, 2000) : ''
    const origin = typeof row.origin === 'string' ? row.origin : ''
    const isLocal = origin.startsWith('loc_book')
    const cover = typeof row.customCoverUrl === 'string' && row.customCoverUrl ? row.customCoverUrl : typeof row.coverUrl === 'string' ? row.coverUrl : ''
    addBook(name, author, {
      coverUrl: cover || null,
      meta: {
        ...(origin ? { local: isLocal } : {}),
        originName: typeof row.originName === 'string' ? row.originName.slice(0, 200) : undefined,
        intro: typeof row.intro === 'string' ? row.intro.slice(0, 500) : undefined,
      },
    })
  }

  const notes: ImportNote[] = []
  for (const row of bookmarkRows) {
    if (notes.length >= MAX_RECORDS) { bump('record-limit'); break }
    const time = typeof row.time === 'number' && Number.isSafeInteger(row.time) && row.time >= 0 ? row.time : null
    const name = typeof row.bookName === 'string' ? row.bookName.slice(0, 2000) : ''
    if (time === null || !name) { bump('bookmark-invalid'); continue }
    const author = typeof row.bookAuthor === 'string' ? row.bookAuthor.slice(0, 2000) : ''
    const text = typeof row.bookText === 'string' ? row.bookText.slice(0, 20000) : ''
    const content = typeof row.content === 'string' && row.content ? row.content.slice(0, 20000) : null
    const key = addBook(name, author, { meta: { implicit: true } })
    notes.push({
      sourceBookId: key,
      sourceRecordId: `bm-${time}`,
      kind: content ? 'idea' : 'highlight',
      text,
      note: content,
      chapter: typeof row.chapterName === 'string' ? row.chapterName.slice(0, 500) : null,
      // A legado bookmark carries no color; the kind default applies.
      color: null,
      locator: null,
      chapterIndex: typeof row.chapterIndex === 'number' && Number.isSafeInteger(row.chapterIndex) && row.chapterIndex >= 0 ? row.chapterIndex : null,
      createdAt: time,
    })
  }

  const durationFacts: ImportProposal['durationFacts'] = []
  for (const row of recordRows) {
    const name = typeof row.bookName === 'string' ? row.bookName : ''
    const deviceId = typeof row.deviceId === 'string' ? row.deviceId : null
    const readTime = typeof row.readTime === 'number' && Number.isSafeInteger(row.readTime) ? row.readTime : null
    if (!name || !deviceId || readTime === null || readTime < 0) { bump('readrecord-invalid'); continue }
    const seconds = Math.round(readTime / 1000)
    if (seconds > MAX_BOOK_SECONDS) { bump('duration-implausible'); continue }
    const matches = [...books.values()].filter((book) => book.title === name)
    let sourceBookId: string
    if (matches.length === 1) {
      sourceBookId = matches[0]!.sourceBookId
    } else {
      sourceBookId = `unknown:${createHash('sha256').update(name).digest('hex')}`
      if (!books.has(sourceBookId)) books.set(sourceBookId, {
        sourceBookId,
        title: name.slice(0, 2000),
        author: '',
        coverUrl: null,
        finished: null,
        meta: {},
      })
      if (matches.length > 1) bump('duration-book-author-ambiguous')
    }
    durationFacts.push({
      sourceBookId,
      sourceRecordKey: `device-book:${createHash('sha256').update(JSON.stringify([deviceId, name])).digest('hex')}`,
      granularity: 'book_total',
      date: null,
      seconds,
      aggregationRole: 'additive',
    })
  }

  return { books: [...books.values()], notes, reviews: [], durationFacts, skipped: 0, unprocessable }
}
