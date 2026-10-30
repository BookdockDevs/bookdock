import { and, eq } from 'drizzle-orm'

import type { MetadataCandidate, MetadataConfiguration, MetadataProviderId } from '@bookdock/shared'
import { parsePersonalProvider } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { detectImageExtension } from '../../lib/cover'
import { decryptPassword, encryptPassword } from '../../lib/secrets'
import { AppError } from '../../middleware/error'
import { parseDoubanDetail, parseDoubanSearch } from './douban-metadata'
import { request } from './metadata-http'
import { assertPublicHttpsUrl } from './personal-source-fetch'
import { getWeReadKey, isWeReadCover, searchWeRead, updateWeReadKey } from './weread.service'

const SETTINGS_KEY = 'metadata-lookup'
type KeyProvider = 'googlebooks'
type Secrets = Partial<Record<KeyProvider, string>>

function storedSecrets(userId: string): Secrets {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY))).get()
  return (row?.value ?? {}) as Secrets
}

export function metadataConfiguration(userId: string): MetadataConfiguration {
  const secrets = storedSecrets(userId)
  const gbKey = decryptPassword(secrets.googlebooks)
  const wrKey = getWeReadKey(userId)
  return {
    googlebooks: Boolean(gbKey),
    weread: Boolean(wrKey),
    keys: {
      googlebooks: gbKey,
      weread: wrKey,
    },
  }
}

export function updateMetadataSecret(provider: KeyProvider | 'weread', key: string | null, actorId: string) {
  if (provider === 'weread') {
    updateWeReadKey(actorId, key)
    return metadataConfiguration(actorId)
  }
  const db = getDb()
  const userId = actorId
  const old = storedSecrets(userId)
  const value = { ...old, [provider]: key ? encryptPassword(key) : undefined }
  const row = db.select({ id: settings.id }).from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY))).get()
  if (row) db.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
  else db.insert(settings).values({ id: createId('setting'), userId, key: SETTINGS_KEY, value }).run()
  return metadataConfiguration(actorId)
}


function text(value: unknown, max = 500): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function parseResponse<T>(raw: string): T {
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
    return value as T
  } catch { throw new AppError('VALIDATION_ERROR', 'Invalid metadata source response') }
}

export async function searchMetadata(provider: MetadataProviderId, query: string, testKey?: string, userId?: string): Promise<MetadataCandidate[]> {
  if (provider === 'weread') {
    const key = testKey ?? (userId ? getWeReadKey(userId) : null)
    if (!key) throw new AppError('VALIDATION_ERROR', 'WeRead API key is not configured')
    return searchWeRead(key, query)
  }
  if (provider === 'douban') {
    const params = new URLSearchParams({ cat: '1001', q: query })
    const html = await request(`https://www.douban.com/search?${params}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 'Accept-Encoding': 'identity' } })
    return parseDoubanSearch(html)
  }
  if (provider === 'qidian') {
    const html = await request(`https://m.qidian.com/so/${encodeURIComponent(query)}.html?pageNum=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36', Referer: 'https://m.qidian.com/' },
    })
    const match = html.match(/<script\b[^>]*\bid=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i)
    if (!match?.[1]) throw new AppError('VALIDATION_ERROR', 'Qidian search response could not be read')
    const data = parseResponse<{ pageContext?: { pageProps?: { pageData?: { bookInfo?: { records?: Array<Record<string, unknown>> } } } } }>(match[1])
    const records = data.pageContext?.pageProps?.pageData?.bookInfo?.records
    if (!Array.isArray(records)) throw new AppError('VALIDATION_ERROR', 'Invalid Qidian search response')
    return records.slice(0, 20).flatMap((book) => {
      if (!book || typeof book !== 'object') return []
      const id = String(book.bid ?? '')
      const title = text(book.bName)
      if (!/^\d+$/.test(id) || !title) return []
      const author = text(book.bAuth)
      const description = typeof book.desc === 'string' ? book.desc : ''
      return [{ id, provider, title, authors: author ? [author] : [], description: description.trim() ? description : undefined, coverUrl: `https://bookcover.yuewen.com/qdbimg/349573/${id}/300`, sourceUrl: `https://www.qidian.com/book/${id}/` }]
    })
  }
  if (provider === 'bangumi') {
    const data = parseResponse<{ data?: Array<Record<string, unknown>> }>(await request('https://api.bgm.tv/v0/search/subjects?limit=20', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: query, filter: { type: [1] } }),
    }))
    if (!Array.isArray(data.data)) throw new AppError('VALIDATION_ERROR', 'Invalid Bangumi search response')
    return data.data.flatMap((book) => {
      if (!book || typeof book !== 'object') return []
      const id = typeof book.id === 'number' ? String(book.id) : ''
      const title = text(book.name_cn) ?? text(book.name)
      if (!/^\d+$/.test(id) || !title) return []
      const infobox = Array.isArray(book.infobox) ? book.infobox as Array<Record<string, unknown>> : []
      const field = (name: string, max = 500) => text(infobox.find((entry) => entry.key === name)?.value, max)
      const author = field('作者')
      const description = typeof book.summary === 'string' ? book.summary : ''
      const images = book.images as Record<string, unknown> | undefined
      const rawCover = text(images?.medium, 2048)
      const coverUrl = rawCover && /^https:\/\/lain\.bgm\.tv\/r\/800\/pic\/cover\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/.test(rawCover) ? rawCover : undefined
      return [{ id, provider, title, authors: author ? [author] : [], description: description.trim() ? description : undefined, publisher: field('出版社', 200), published: field('发售日', 50) ?? text(book.date, 50), isbn: field('ISBN', 20), coverUrl, sourceUrl: `https://bgm.tv/subject/${id}` }]
    })
  }
  if (provider === 'openlibrary') {
    const params = new URLSearchParams({ title: query, limit: '20', fields: 'key,title,author_name,first_publish_year,cover_i' })
    const data = parseResponse<{ docs?: Array<Record<string, unknown>> }>(await request(`https://openlibrary.org/search.json?${params}`))
    if (!Array.isArray(data.docs)) throw new AppError('VALIDATION_ERROR', 'Invalid Open Library search response')
    return data.docs.flatMap((book) => {
      if (!book || typeof book !== 'object') return []
      const id = text(book.key)
      const title = text(book.title)
      if (!id || !/^\/works\/OL\d+W$/.test(id) || !title) return []
      const cover = typeof book.cover_i === 'number' ? book.cover_i : null
      return [{ id, provider, title, authors: Array.isArray(book.author_name) ? book.author_name.map((v) => text(v)).filter((v): v is string => Boolean(v)).slice(0, 10) : [], coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-M.jpg` : undefined, sourceUrl: `https://openlibrary.org${id}` }]
    })
  }
  if (provider === 'googlebooks') {
    const key = testKey ?? (userId ? decryptPassword(storedSecrets(userId).googlebooks) : null)
    if (!key) throw new AppError('VALIDATION_ERROR', 'Google Books API key is not configured')
    const params = new URLSearchParams({ q: query, maxResults: '20', key })
    const data = parseResponse<{ items?: Array<Record<string, unknown>> }>(await request(`https://www.googleapis.com/books/v1/volumes?${params}`))
    if (data.items !== undefined && !Array.isArray(data.items)) throw new AppError('VALIDATION_ERROR', 'Invalid Google Books search response')
    return (data.items ?? []).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const id = text(item.id)
      const book = item.volumeInfo as Record<string, unknown> | undefined
      const title = text(book?.title)
      if (!id || !title) return []
      const images = book?.imageLinks as Record<string, unknown> | undefined
      const description = typeof book?.description === 'string' && book.description.trim() ? book.description.trim().replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '') : undefined
      const identifiers = Array.isArray(book?.industryIdentifiers) ? book.industryIdentifiers as Array<Record<string, unknown>> : []
      const isbn = identifiers.find((item) => item.type === 'ISBN_13') ?? identifiers.find((item) => item.type === 'ISBN_10')
      const thumbnail = text(images?.thumbnail, 2048)?.replace(/^http:/, 'https:')
      let coverUrl: string | undefined
      try {
        const url = thumbnail && new URL(thumbnail)
        if (url && url.protocol === 'https:' && url.hostname === 'books.google.com' && url.pathname === '/books/content' && !url.port && !url.username && !url.password) coverUrl = url.href
      } catch { /* An invalid image URL is treated as missing. */ }
      return [{ id, provider, title, authors: Array.isArray(book?.authors) ? book.authors.map((v) => text(v)).filter((v): v is string => Boolean(v)).slice(0, 10) : [], description, publisher: text(book?.publisher, 200), published: text(book?.publishedDate, 50), language: text(book?.language, 20), isbn: text(isbn?.identifier, 20), coverUrl, sourceUrl: `https://books.google.com/books?id=${encodeURIComponent(id)}` }]
    })
  }
  throw new AppError('VALIDATION_ERROR', 'Metadata source is not available')
}

export async function getDoubanMetadata(id: string): Promise<MetadataCandidate> {
  if (!/^\d{1,20}$/.test(id)) throw new AppError('VALIDATION_ERROR', 'Invalid Douban book ID')
  const html = await request(`https://book.douban.com/subject/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 'Accept-Encoding': 'identity' } })
  return parseDoubanDetail(html, id)
}

export async function fetchMetadataCover(provider: MetadataProviderId, source: string): Promise<{ bytes: Buffer; contentType: string }> {
  const personal = Boolean(parsePersonalProvider(provider))
  let url: URL
  try { url = new URL(source) } catch { throw new AppError('VALIDATION_ERROR', 'Invalid cover URL') }
  // Personal sources have no fixed cover hosts; any public https address is
  // accepted after resolving it and rejecting private network targets.
  if (personal) {
    url = await assertPublicHttpsUrl(source)
  } else {
    const allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      (provider === 'openlibrary' && url.hostname === 'covers.openlibrary.org' && /^\/b\/id\/\d+-[SML]\.jpg$/.test(url.pathname)) ||
      (provider === 'googlebooks' && url.hostname === 'books.google.com' && url.pathname === '/books/content') ||
      (provider === 'weread' && isWeReadCover(url)) ||
      (provider === 'douban' && /^img\d+\.doubanio\.com$/.test(url.hostname) && /^\/view\/subject\/[a-z]+\/public\/[\w-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname) && !url.search && !url.hash) ||
      (provider === 'qidian' && url.hostname === 'bookcover.yuewen.com' && /^\/qdbimg\/349573\/\d+\/300$/.test(url.pathname)) ||
      (provider === 'bangumi' && url.hostname === 'lain.bgm.tv' && /^\/r\/800\/pic\/cover\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname))
    )
    if (!allowed) throw new AppError('VALIDATION_ERROR', 'Unsupported cover URL')
  }
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      ...(provider === 'douban' ? { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', Referer: 'https://book.douban.com/' } } : {}),
    })
  } catch { throw new AppError('VALIDATION_ERROR', 'Cover source unavailable') }
  if (!response.ok || !response.body) throw new AppError('VALIDATION_ERROR', 'Cover source unavailable')
  // For personal sources the format check happens on the downloaded bytes
  // below; fixed providers keep the header precheck before reading.
  const contentType = personal ? 'image/jpeg' : response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!personal && !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new AppError('VALIDATION_ERROR', 'Unsupported cover format')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 8_000_000) throw new AppError('VALIDATION_ERROR', 'Cover is too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = Buffer.concat(chunks)
  // Personal-source CDNs often mislabel content types (observed
  // application/octet-stream), so trust the magic bytes for those.
  const detectedType = personal
    ? { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[detectImageExtension(bytes) ?? ''] ?? ''
    : contentType
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(detectedType)) throw new AppError('VALIDATION_ERROR', 'Unsupported cover format')
  return { bytes, contentType: detectedType }
}
