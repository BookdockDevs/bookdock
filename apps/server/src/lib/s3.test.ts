import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../middleware/error'
import { parseListObjectsV2Xml, S3Client, signS3Request } from './s3'

function makeClient() {
  return new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'bookdock',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    basePath: '/import',
  })
}

function mockResponse(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers })
}

describe('S3 SigV4 signing', () => {
  it('produces deterministic signatures with expected shape', () => {
    const args = {
      method: 'GET',
      canonicalUri: '/bookdock/import/a.epub',
      query: { 'list-type': '2', delimiter: '/', prefix: 'import/' },
      payloadHash: 'UNSIGNED-PAYLOAD',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      region: 'us-east-1',
      host: 'localhost:9000',
      amzDate: '20260101T000000Z',
      dateStamp: '20260101',
    }
    const first = signS3Request(args)
    const second = signS3Request(args)
    expect(first).toBe(second)
    expect(first).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20260101\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    const different = signS3Request({ ...args, secretKey: 'OTHER' })
    expect(different).not.toBe(first)
  })
})

describe('S3 key mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefixes keys with basePath and uses path-style URLs', async () => {
    const client = makeClient()
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url)
      return mockResponse(200)
    }))
    await client.upload('/sci-fi/dune.epub', Buffer.from('data'))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe('http://localhost:9000/bookdock/import/sci-fi/dune.epub')
  })

  it('uploads to bucket root when basePath is /', async () => {
    const client = new S3Client({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'bookdock',
      accessKey: 'ak',
      secretKey: 'sk',
      basePath: '/',
    })
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url)
      return mockResponse(200)
    }))
    await client.upload('/a.epub', Buffer.from('x'))
    expect(seen[0]).toBe('http://localhost:9000/bookdock/a.epub')
  })

  it('rejects path traversal', async () => {
    const client = makeClient()
    await expect(client.upload('/../secret.epub', Buffer.from('x'))).rejects.toThrow(AppError)
    await expect(client.download('/a/../../b.epub')).rejects.toThrow(AppError)
  })

  it('rejects missing bucket and invalid endpoint', () => {
    expect(() => new S3Client({
      endpoint: 'http://localhost:9000',
      bucket: '',
      accessKey: 'ak',
      basePath: '/',
    })).toThrow(AppError)
    expect(() => new S3Client({
      endpoint: 'not-a-url',
      bucket: 'b',
      accessKey: 'ak',
      basePath: '/',
    })).toThrow(AppError)
  })
})

describe('S3 list parsing', () => {
  it('parses prefixes and contents', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>false</IsTruncated>
  <CommonPrefixes><Prefix>import/fiction/</Prefix></CommonPrefixes>
  <Contents><Key>import/a.epub</Key><Size>12</Size><LastModified>2026-01-02T03:04:05.000Z</LastModified></Contents>
  <Contents><Key>import/b.txt</Key><Size>7</Size></Contents>
</ListBucketResult>`
    const parsed = parseListObjectsV2Xml(xml)
    expect(parsed.prefixes).toEqual(['import/fiction/'])
    expect(parsed.contents).toHaveLength(2)
    expect(parsed.contents[0]).toMatchObject({ key: 'import/a.epub', size: 12 })
    expect(parsed.isTruncated).toBe(false)
  })

  it('lists directories first with support flags', async () => {
    const client = makeClient()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>false</IsTruncated>
  <CommonPrefixes><Prefix>import/fiction/</Prefix></CommonPrefixes>
  <Contents><Key>import/z.pdf</Key><Size>5</Size></Contents>
  <Contents><Key>import/a.epub</Key><Size>10</Size></Contents>
</ListBucketResult>`
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, xml)))
    const entries = await client.list('/')
    expect(entries.map((e) => e.name)).toEqual(['fiction', 'a.epub', 'z.pdf'])
    expect(entries[0].type).toBe('dir')
    expect(entries.find((e) => e.name === 'a.epub')?.isSupported).toBe(true)
    expect(entries.find((e) => e.name === 'z.pdf')?.isSupported).toBe(false)
    vi.unstubAllGlobals()
  })

  it('follows continuation tokens', async () => {
    const client = makeClient()
    const first = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>tok1</NextContinuationToken>
  <Contents><Key>import/a.epub</Key><Size>1</Size></Contents>
</ListBucketResult>`
    const second = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>false</IsTruncated>
  <Contents><Key>import/b.epub</Key><Size>2</Size></Contents>
</ListBucketResult>`
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return mockResponse(200, calls.length === 1 ? first : second)
    }))
    const entries = await client.list('/')
    expect(entries).toHaveLength(2)
    expect(calls[1]).toContain('continuation-token=tok1')
    vi.unstubAllGlobals()
  })
})

describe('S3 error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps HeadBucket 403 to connection failure and 404 to missing bucket', async () => {
    const client = makeClient()
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(403)))
    await expect(client.testConnection()).rejects.toMatchObject({ code: 'S3_CONNECTION_FAILED' })
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(404)))
    await expect(client.testConnection()).rejects.toMatchObject({ code: 'S3_FILE_NOT_FOUND' })
  })

  it('treats delete 404 as success and maps 403', async () => {
    const client = makeClient()
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(404)))
    await expect(client.delete('/a.epub')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(403)))
    await expect(client.delete('/a.epub')).rejects.toMatchObject({ code: 'S3_CONNECTION_FAILED' })
  })

  it('returns false from exists on missing keys', async () => {
    const client = makeClient()
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(404)))
    expect(await client.exists('/nope.epub')).toBe(false)
  })

  it('reads size from HEAD content-length', async () => {
    const client = makeClient()
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, '', { 'content-length': '42' })))
    expect(await client.size('/a.epub')).toBe(42)
  })

  it('mkdir is a no-op for object storage', async () => {
    const client = makeClient()
    await expect(client.mkdir('/a/b/c')).resolves.toBeUndefined()
  })
})
