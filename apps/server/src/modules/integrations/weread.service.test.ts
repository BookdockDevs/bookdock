import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.JWT_SECRET = 'test-secret' })

import * as client from '../../db/client'
import { getWeReadKey, getWeReadMetadata, isWeReadCover, searchWeRead, updateWeReadKey } from './weread.service'
import { metadataConfiguration, updateMetadataSecret } from './metadata-lookup.service'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('WeRead integration', () => {
  it('keeps encrypted WeRead and Google keys isolated by user', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(user_id, key))')
    const db = drizzle(sqlite)
    vi.spyOn(client, 'getDb').mockReturnValue(db as ReturnType<typeof client.getDb>)
    updateWeReadKey('a', 'private-weread-a')
    updateWeReadKey('b', 'private-weread-b')
    updateMetadataSecret('googlebooks', 'private-google-a', 'a')
    expect(getWeReadKey('a')).toBe('private-weread-a')
    expect(getWeReadKey('b')).toBe('private-weread-b')
    expect(metadataConfiguration('a')).toEqual({ googlebooks: true, weread: true, keys: { googlebooks: 'private-google-a', weread: 'private-weread-a' } })
    expect(metadataConfiguration('b')).toEqual({ googlebooks: false, weread: true, keys: { googlebooks: null, weread: 'private-weread-b' } })
    expect(JSON.stringify(sqlite.prepare('SELECT value FROM settings').all())).not.toContain('private-')
    updateWeReadKey('a', null)
    expect(getWeReadKey('a')).toBeNull()
    expect(getWeReadKey('b')).toBe('private-weread-b')
    sqlite.close()
  })

  it('searches the chosen scope once and retrieves selected details', async () => {
    const ebook = { bookId: '123', title: 'Book', author: 'Writer', cover: 'https://cdn.weread.qq.com/weread/cover/80/123/s_123.jpg', deepLink: 'https://weread.qq.com/book-detail?type=1&v=abc' }
    const novel = { bookId: '456', title: 'Novel', author: 'Author', cover: 'https://wfqqreader-1252317822.image.myqcloud.com/cover/91/456/s_456.jpg' }
    const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.api_name === '/book/info') return new Response(JSON.stringify({ ...ebook, intro: 'Description', publisher: 'Publisher', isbn: '9781234567890' }))
      return new Response(JSON.stringify({ results: [{ scope: 17, books: [{ bookInfo: ebook }] }, { scope: 16, books: [{ bookInfo: novel }, { bookInfo: ebook }] }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchWeRead('secret', 'Book')
    expect(results.map((item) => item.id)).toEqual(['123', '456'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).scope).toBe(0)
    await searchWeRead('secret', 'Book', 'ebooks')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).scope).toBe(10)
    expect(await getWeReadMetadata('secret', '123')).toMatchObject({ title: 'Book', description: 'Description', publisher: 'Publisher', isbn: '9781234567890' })
    expect(isWeReadCover(new URL(novel.cover))).toBe(true)
    expect(isWeReadCover(new URL('https://cdn.weread.qq.com.evil.example/weread/cover/80/123/a.jpg'))).toBe(false)
  })

  it('rejects gateway errors and upgrade responses instead of treating them as empty results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ upgrade_info: { message: 'upgrade' } }))))
    await expect(searchWeRead('secret', 'Book')).rejects.toThrow('WeRead source returned an error or requires an upgrade')
  })

  it('ignores the placeholder date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ results: [{ books: [{ bookInfo: { bookId: '123', title: 'Book', publishTime: '1970-01-01 00:00:00' } }] }] }))
    }))
    const result = await searchWeRead('secret', 'Book')
    expect(result).toHaveLength(1)
    expect(result[0]?.published).toBeUndefined()
  })

  it('preserves plain-text description whitespace for search and detail', async () => {
    const description = `　　First\r\n${'x'.repeat(6000)}\r\n　　`
    const book = { bookId: '123', title: 'Book', intro: description }
    const blank = { bookId: '456', title: 'Blank', intro: '　 \r\n' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.api_name === '/book/info') return new Response(JSON.stringify(book))
      return new Response(JSON.stringify({ results: [{ books: [{ bookInfo: book }, { bookInfo: blank }] }] }))
    }))
    const results = await searchWeRead('secret', 'Book')
    expect(results[0]?.description).toBe(description)
    expect(results[1]?.description).toBeUndefined()
    expect((await getWeReadMetadata('secret', '123')).description).toBe(description)
  })
})
