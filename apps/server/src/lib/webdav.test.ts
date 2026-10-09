import { afterEach, describe, expect, it, vi } from 'vitest'
import { basicAuthHeader, buildRemoteUrl, parsePropfindXml, WebDavClient } from './webdav'
import { AppError } from '../middleware/error'

describe('WebDAV client protocol', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildRemoteUrl', () => {
    it('constructs correct root URLs', () => {
      const url = buildRemoteUrl('https://dav.example.com/dav/', '/', '/')
      expect(url.toString()).toBe('https://dav.example.com/dav/')
    })

    it('combines server pathname, basePath and subPath properly', () => {
      const url = buildRemoteUrl('https://dav.example.com/dav', '/books', '/sci-fi/dune.epub')
      expect(url.toString()).toBe('https://dav.example.com/dav/books/sci-fi/dune.epub')
    })

    it('properly encodes Chinese characters and spaces without double-encoding', () => {
      const url = buildRemoteUrl('https://dav.example.com/dav/', '/我的网盘/书籍', '/科幻/三体 (全集).epub')
      expect(url.pathname).toBe('/dav/%E6%88%91%E7%9A%84%E7%BD%91%E7%9B%98/%E4%B9%A6%E7%B1%8D/%E7%A7%91%E5%B9%BB/%E4%B8%89%E4%BD%93%20(%E5%85%A8%E9%9B%86).epub')
    })

    it('rejects path traversal with double dots', () => {
      expect(() => buildRemoteUrl('https://dav.example.com/dav', '/', '/../secret.txt')).toThrow(AppError)
      expect(() => buildRemoteUrl('https://dav.example.com/dav', '/../bad', '/file.epub')).toThrow(AppError)
    })

    it('rejects invalid server URLs', () => {
      expect(() => buildRemoteUrl('not-a-url', '/', '/')).toThrow(AppError)
    })
  })

  describe('basicAuthHeader', () => {
    it('creates standard Basic Auth headers', () => {
      expect(basicAuthHeader('admin', '123456')).toBe('Basic ' + Buffer.from('admin:123456').toString('base64'))
    })
  })

  describe('parsePropfindXml', () => {
    const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/books/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/books/Fiction/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/books/novel.epub</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>2048000</d:getcontentlength>
        <d:getlastmodified>Sun, 06 Nov 2024 08:49:37 GMT</d:getlastmodified>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/books/notes.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>1024</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/books/document.pdf</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>512000</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

    it('parses entries, ignores parent collection, and sorts directories first', () => {
      const entries = parsePropfindXml(sampleXml, '/')
      expect(entries).toHaveLength(4)
      // Dirs first
      expect(entries[0]).toEqual({
        name: 'Fiction',
        path: '/Fiction',
        type: 'dir',
        size: 0,
        updatedAt: undefined,
        isSupported: false,
      })
      // EPUB file
      expect(entries[1].name).toBe('document.pdf')
      expect(entries[1].isSupported).toBe(false) // pdf not supported
      expect(entries[2].name).toBe('notes.txt')
      expect(entries[2].isSupported).toBe(true)
      expect(entries[3].name).toBe('novel.epub')
      expect(entries[3].isSupported).toBe(true)
      expect(entries[3].size).toBe(2048000)
      expect(entries[3].updatedAt).toBeGreaterThan(0)
    })

    it('respects maxSizeBytes and marks oversize files as unsupported', () => {
      const entries = parsePropfindXml(sampleXml, '/', 1000000) // 1MB limit
      const novel = entries.find((e) => e.name === 'novel.epub')
      const notes = entries.find((e) => e.name === 'notes.txt')
      expect(novel?.isSupported).toBe(false)
      expect(notes?.isSupported).toBe(true)
    })

    it('supports uppercase D: namespace prefixes and URL-encoded hrefs', () => {
      const upperNamespaceXml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/%E7%A7%91%E5%B9%BB/%E4%B8%89%E4%BD%93.epub</D:href>
    <D:propstat>
      <D:prop>
        <D:getcontentlength>100000</D:getcontentlength>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`
      const entries = parsePropfindXml(upperNamespaceXml, '/科幻')
      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('三体.epub')
      expect(entries[0].path).toBe('/科幻/三体.epub')
      expect(entries[0].isSupported).toBe(true)
    })
  })

  describe('WebDavClient execution', () => {
    const config = {
      url: 'https://dav.test.com/dav/',
      username: 'user',
      password: 'password',
      basePath: '/',
    }

    it('testConnection returns latency on 207 Multi-Status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 207 }))
      const client = new WebDavClient(config)
      const res = await client.testConnection()
      expect(res.success).toBe(true)
      expect(res.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('testConnection throws on 401 Unauthorized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 401 }))
      const client = new WebDavClient(config)
      await expect(client.testConnection()).rejects.toThrow('Authentication failed')
    })

    it('list executes PROPFIND and parses XML', async () => {
      const xml = `<d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/test.epub</d:href>
          <d:propstat>
            <d:prop><d:getcontentlength>123</d:getcontentlength><d:resourcetype/></d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(xml, { status: 207 }))
      const client = new WebDavClient(config)
      const list = await client.list('/')
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('test.epub')
    })

    it('download retrieves file buffer', async () => {
      const content = Buffer.from('hello epub')
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(content, { status: 200 }))
      const client = new WebDavClient(config)
      const downloaded = await client.download('/books/hello.epub')
      expect(downloaded.name).toBe('hello.epub')
      expect(downloaded.size).toBe(content.length)
      expect(downloaded.buffer.toString()).toBe('hello epub')
    })

    it('download throws 404 when file does not exist', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }))
      const client = new WebDavClient(config)
      await expect(client.download('/missing.epub')).rejects.toThrow('Remote file not found')
    })
  })
})
