import { and, eq } from 'drizzle-orm'

import type { MetadataCandidate, WeReadSearchScope } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { decryptPassword, encryptPassword } from '../../lib/secrets'
import { AppError } from '../../middleware/error'
import { request } from './metadata-http'

const SETTINGS_KEY = 'weread-integration'
const VERSION = '1.0.5'

export function getWeReadKey(userId: string): string | null {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY))).get()
  return decryptPassword((row?.value as { key?: string } | undefined)?.key)
}

export function updateWeReadKey(userId: string, key: string | null): void {
  const db = getDb()
  const row = db.select({ id: settings.id }).from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY))).get()
  if (!key) {
    if (row) db.delete(settings).where(eq(settings.id, row.id)).run()
  } else if (row) db.update(settings).set({ value: { key: encryptPassword(key) } }).where(eq(settings.id, row.id)).run()
  else db.insert(settings).values({ id: createId('setting'), userId, key: SETTINGS_KEY, value: { key: encryptPassword(key) } }).run()
}

async function gateway(key: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = await request('https://i.weread.qq.com/api/agent/gateway', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...payload, skill_version: VERSION }),
  })
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response')
    const data = value as Record<string, unknown>
    if (data.upgrade_info || data.errcode || data.error) throw new Error('Gateway error')
    return data
  } catch { throw new AppError('VALIDATION_ERROR', 'WeRead source returned an error or requires an upgrade') }
}

function text(value: unknown, max = 500): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function image(value: unknown): string | undefined {
  const raw = text(value, 2048)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    ) {
      const isCdn = url.hostname === 'cdn.weread.qq.com' && (/^\/weread\/cover\/[\w/-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname) || /^\/outpic\/[\w/-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname))
      const isQcloud = url.hostname === 'wfqqreader-1252317822.image.myqcloud.com' && /^\/cover\/[\w/-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname)
      if (isCdn || isQcloud) {
        url.pathname = url.pathname.replace(/\/s_([a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp))$/, '/t6_$1')
        return url.href
      }
    }
  } catch { /* Invalid source images are ignored. */ }
  return undefined
}

export function isWeReadCover(url: URL): boolean { return image(url.href) !== undefined }

function candidate(book: Record<string, unknown>): MetadataCandidate | null {
  const id = text(book.bookId, 128)
  const title = text(book.title)
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !title) return null
  const author = text(book.author)
  const description = typeof book.intro === 'string' ? book.intro : ''
  const published = text(book.publishTime, 50)?.replace(/ 00:00:00$/, '')
  let sourceUrl = 'https://weread.qq.com/'
  try {
    const url = new URL(text(book.deepLink, 2048) ?? '')
    if (url.protocol === 'https:' && url.hostname === 'weread.qq.com' && !url.port && !url.username && !url.password && url.pathname === '/book-detail') sourceUrl = url.href
  } catch { /* The source link is optional. */ }
  return { id, provider: 'weread', title, authors: author ? [author] : [], description: description.trim() ? description : undefined, publisher: text(book.publisher, 200), published: published === '1970-01-01' ? undefined : published, isbn: text(book.isbn, 20), coverUrl: image(book.cover), sourceUrl }
}

export async function searchWeRead(key: string, query: string, scope: WeReadSearchScope = 'all'): Promise<MetadataCandidate[]> {
  const data = await gateway(key, { api_name: '/store/search', keyword: query, scope: scope === 'ebooks' ? 10 : 0, count: 20 })
  if (!Array.isArray(data.results)) throw new AppError('VALIDATION_ERROR', 'Invalid WeRead search response')
  const found = new Map<string, MetadataCandidate>()
  for (const group of data.results) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.books)) continue
    for (const entry of group.books) {
      if (!entry || typeof entry !== 'object' || !entry.bookInfo || typeof entry.bookInfo !== 'object') continue
      const item = candidate(entry.bookInfo)
      if (item && !found.has(item.id)) found.set(item.id, item)
    }
  }
  return [...found.values()].slice(0, 20)
}

export async function getWeReadMetadata(key: string, id: string): Promise<MetadataCandidate> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new AppError('VALIDATION_ERROR', 'Invalid WeRead book ID')
  const book = candidate(await gateway(key, { api_name: '/book/info', bookId: id }))
  if (!book || book.id !== id) throw new AppError('VALIDATION_ERROR', 'Invalid WeRead detail response')
  return book
}
