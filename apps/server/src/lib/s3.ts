import { createHash, createHmac } from 'node:crypto'
import { Readable } from 'node:stream'

import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom'
import type { WebDavEntry } from '@bookdock/shared'

import type { RemoteBrowseClient } from './remote-client'
import { AppError } from '../middleware/error'

export interface S3ClientConfig {
  endpoint: string
  region?: string
  bucket: string
  accessKey: string
  secretKey?: string
  basePath: string
}

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
const MAX_LIST_KEYS = 1000

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/')
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const amzDate =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secret}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, 's3')
  return hmacSha256(kService, 'aws4_request')
}

export function signS3Request(args: {
  method: string
  canonicalUri: string
  query: Record<string, string>
  payloadHash: string
  accessKey: string
  secretKey: string
  region: string
  host: string
  amzDate: string
  dateStamp: string
}): string {
  const sortedKeys = Object.keys(args.query).sort()
  const canonicalQuery = sortedKeys.map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(args.query[k])}`).join('&')
  const canonicalHeaders = `host:${args.host}\nx-amz-content-sha256:${args.payloadHash}\nx-amz-date:${args.amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [args.method, args.canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, args.payloadHash].join('\n')
  const scope = `${args.dateStamp}/${args.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', args.amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacSha256(signingKey(args.secretKey, args.dateStamp, args.region), stringToSign).toString('hex')
  return `AWS4-HMAC-SHA256 Credential=${args.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function assertNoTraversal(value: string, field: string): void {
  if (value.split('/').some((seg) => seg === '..')) {
    throw new AppError('VALIDATION_ERROR', `Path traversal is not allowed in ${field}`)
  }
}

function cleanSegments(value: string): string[] {
  return value.split('/').map((s) => s.trim()).filter(Boolean)
}

function textOf(parent: XmlElement, tag: string): string {
  const els = parent.getElementsByTagName(tag)
  if (!els || els.length === 0) return ''
  return (els[0].textContent || '').trim()
}

export function parseListObjectsV2Xml(xmlText: string): {
  contents: Array<{ key: string; size: number; lastModified?: number }>
  prefixes: string[]
  isTruncated: boolean
  nextToken?: string
} {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xmlText, 'text/xml')
  const root = doc.documentElement
  const contents: Array<{ key: string; size: number; lastModified?: number }> = []
  const prefixes: string[] = []
  if (!root) return { contents, prefixes, isTruncated: false }

  const contentEls = root.getElementsByTagName('Contents')
  for (let i = 0; i < contentEls.length; i++) {
    const el = contentEls[i]
    const key = textOf(el, 'Key')
    if (!key) continue
    const size = parseInt(textOf(el, 'Size'), 10)
    const parsedTime = Date.parse(textOf(el, 'LastModified'))
    contents.push({
      key,
      size: Number.isNaN(size) || size < 0 ? 0 : size,
      lastModified: Number.isNaN(parsedTime) ? undefined : parsedTime,
    })
  }

  const prefixEls = root.getElementsByTagName('CommonPrefixes')
  for (let i = 0; i < prefixEls.length; i++) {
    const prefix = textOf(prefixEls[i], 'Prefix')
    if (prefix) prefixes.push(prefix)
  }

  const isTruncated = textOf(root, 'IsTruncated').toLowerCase() === 'true'
  const nextToken = textOf(root, 'NextContinuationToken') || undefined
  return { contents, prefixes, isTruncated, nextToken }
}

function toSupportedEntry(name: string, itemPath: string, type: 'dir' | 'file', size: number, updatedAt: number | undefined, maxSizeBytes?: number | null): WebDavEntry {
  const lowerName = name.toLowerCase()
  const isSupportedFormat = type === 'file' && (lowerName.endsWith('.epub') || lowerName.endsWith('.txt'))
  const withinSize = typeof maxSizeBytes === 'number' && maxSizeBytes > 0 ? size <= maxSizeBytes : true
  return { name, path: itemPath, type, size, updatedAt, isSupported: type === 'dir' ? false : isSupportedFormat && withinSize }
}

export class S3Client implements RemoteBrowseClient {
  private readonly endpointOrigin: string
  private readonly endpointPrefix: string
  private readonly host: string
  private readonly region: string
  private readonly bucket: string
  private readonly accessKey: string
  private readonly secretKey: string
  private readonly basePrefix: string

  constructor(config: S3ClientConfig) {
    let url: URL
    try {
      url = new URL(config.endpoint)
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid S3 endpoint URL')
    }
    if (!config.bucket || !config.bucket.trim()) {
      throw new AppError('VALIDATION_ERROR', 'S3 bucket is required')
    }
    assertNoTraversal(config.basePath || '/', 'basePath')
    const prefixSegments = cleanSegments(config.basePath || '/')
    this.endpointOrigin = url.origin
    this.endpointPrefix = '/' + cleanSegments(url.pathname).map(encodeRfc3986).join('/')
    if (this.endpointPrefix === '/') this.endpointPrefix = ''
    this.host = url.host
    this.region = (config.region || 'us-east-1').trim() || 'us-east-1'
    this.bucket = config.bucket.trim()
    this.accessKey = config.accessKey
    this.secretKey = config.secretKey || ''
    this.basePrefix = prefixSegments.map(decodeURIComponent).join('/')
  }

  private toKey(filePath: string): string {
    assertNoTraversal(filePath, 'path')
    const clean = cleanSegments(filePath).map(decodeURIComponent).join('/')
    return this.basePrefix ? (clean ? `${this.basePrefix}/${clean}` : this.basePrefix) : clean
  }

  private listPrefixFor(subPath: string): { prefix: string; cleanSub: string } {
    assertNoTraversal(subPath, 'path')
    const cleanSub = cleanSegments(subPath).map(decodeURIComponent).join('/')
    const full = this.basePrefix ? (cleanSub ? `${this.basePrefix}/${cleanSub}` : this.basePrefix) : cleanSub
    return { prefix: full ? `${full}/` : '', cleanSub }
  }

  private buildUrl(canonicalUri: string, query: Record<string, string>): string {
    const keys = Object.keys(query).sort()
    const qs = keys.map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`).join('&')
    return `${this.endpointOrigin}${canonicalUri}${qs ? `?${qs}` : ''}`
  }

  private async signedFetch(
    method: string,
    key: string | null,
    query: Record<string, string>,
    body?: BodyInit,
    extraHeaders?: Record<string, string>,
    timeoutMs = 15000,
    duplex?: string,
  ): Promise<Response> {
    const encodedKey = key ? encodeKeyPath(key) : ''
    const normalizedUri = key
      ? `${this.endpointPrefix}/${encodeRfc3986(this.bucket)}/${encodedKey}`
      : `${this.endpointPrefix}/${encodeRfc3986(this.bucket)}/`
    const payloadHash = (extraHeaders && extraHeaders['x-amz-content-sha256']) || UNSIGNED_PAYLOAD
    const { amzDate, dateStamp } = toAmzDate(new Date())
    const auth = signS3Request({
      method,
      canonicalUri: normalizedUri,
      query,
      payloadHash,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      host: this.host,
      amzDate,
      dateStamp,
    })
    const url = this.buildUrl(normalizedUri, query)
    return fetch(url, {
      method,
      headers: {
        Authorization: auth,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        ...extraHeaders,
      },
      body,
      // @ts-expect-error duplex is required by Node fetch when streaming request body
      duplex,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number }> {
    const startTime = Date.now()
    try {
      const res = await this.signedFetch('HEAD', null, {}, undefined, undefined, 10000)
      if (res.status === 200) return { success: true, latencyMs: Date.now() - startTime }
      if (res.status === 404) {
        throw new AppError('S3_FILE_NOT_FOUND', `S3 bucket not found: ${this.bucket}`)
      }
      if (res.status === 301) {
        throw new AppError('S3_CONNECTION_FAILED', 'S3 region mismatch (bucket lives in another region)')
      }
      if (res.status === 401 || res.status === 403) {
        throw new AppError('S3_CONNECTION_FAILED', 'Authentication failed (verify access key, secret key and bucket policy)')
      }
      throw new AppError('S3_CONNECTION_FAILED', `S3 server returned HTTP ${res.status}`)
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Cannot connect to S3 storage: ${message}`)
    }
  }

  async list(subPath = '/', maxSizeBytes?: number | null): Promise<WebDavEntry[]> {
    const { prefix, cleanSub } = this.listPrefixFor(subPath)
    const entries: WebDavEntry[] = []
    let continuationToken: string | undefined
    try {
      for (;;) {
        const query: Record<string, string> = {
          'list-type': '2',
          delimiter: '/',
          'max-keys': String(MAX_LIST_KEYS),
          prefix,
        }
        if (continuationToken) query['continuation-token'] = continuationToken
        const res = await this.signedFetch('GET', null, query, undefined, undefined, 15000)
        if (res.status === 401 || res.status === 403) {
          throw new AppError('S3_CONNECTION_FAILED', 'Authentication failed (verify access key and bucket policy)')
        }
        if (res.status === 404) {
          throw new AppError('S3_FILE_NOT_FOUND', `S3 bucket not found: ${this.bucket}`)
        }
        if (!res.ok) {
          throw new AppError('S3_CONNECTION_FAILED', `Failed to list S3 directory (HTTP ${res.status})`)
        }
        const parsed = parseListObjectsV2Xml(await res.text())
        for (const dirPrefix of parsed.prefixes) {
          const relative = dirPrefix.slice(prefix.length).replace(/\/+$/, '')
          if (!relative || relative.includes('/')) continue
          const itemPath = cleanSub ? `/${cleanSub}/${relative}` : `/${relative}`
          entries.push(toSupportedEntry(relative, itemPath, 'dir', 0, undefined, maxSizeBytes))
        }
        for (const item of parsed.contents) {
          if (item.key === prefix.slice(0, -1) || item.key === prefix) continue
          if (!item.key.startsWith(prefix)) continue
          const relative = item.key.slice(prefix.length)
          if (!relative || relative.includes('/')) continue
          const itemPath = cleanSub ? `/${cleanSub}/${relative}` : `/${relative}`
          entries.push(toSupportedEntry(relative, itemPath, 'file', item.size, item.lastModified, maxSizeBytes))
        }
        if (!parsed.isTruncated) break
        if (!parsed.nextToken) break
        continuationToken = parsed.nextToken
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to list S3 directory: ${message}`)
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    return entries
  }

  async download(filePath: string): Promise<{ buffer: Buffer; name: string; size: number }> {
    const key = this.toKey(filePath)
    if (!key) throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
    try {
      const res = await this.signedFetch('GET', key, {}, undefined, undefined, 60000)
      if (res.status === 404 || res.status === 416) {
        throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      if (!res.ok) {
        throw new AppError('S3_CONNECTION_FAILED', `Failed to download file (HTTP ${res.status})`)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      const segments = filePath.split('/').filter(Boolean)
      const name = segments[segments.length - 1] || 'book'
      return { buffer, name, size: buffer.length }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to download file: ${message}`)
    }
  }

  async mkdir(_dirPath: string): Promise<void> {
    assertNoTraversal(_dirPath, 'path')
  }

  async upload(filePath: string, data: Buffer | Uint8Array | NodeJS.ReadableStream): Promise<void> {
    const key = this.toKey(filePath)
    if (!key) throw new AppError('VALIDATION_ERROR', 'Cannot upload to bucket root')
    const isNodeStream = Boolean(data && typeof (data as NodeJS.ReadableStream).pipe === 'function')
    let payloadHash = UNSIGNED_PAYLOAD
    let body: BodyInit
    if (isNodeStream) {
      body = Readable.toWeb(data as Readable) as unknown as BodyInit
    } else {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array)
      payloadHash = sha256Hex(buf)
      body = buf as unknown as BodyInit
    }
    try {
      const res = await this.signedFetch('PUT', key, {}, body, {
        'Content-Type': 'application/octet-stream',
        'x-amz-content-sha256': payloadHash,
      }, 120000, isNodeStream ? 'half' : undefined)
      if (res.status === 401 || res.status === 403) {
        throw new AppError('S3_CONNECTION_FAILED', 'Account lacks permission to upload file')
      }
      if (!res.ok && res.status !== 200) {
        throw new AppError('S3_CONNECTION_FAILED', `Failed to upload file (HTTP ${res.status})`)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to upload file to S3: ${message}`)
    }
  }

  async delete(filePath: string): Promise<void> {
    const key = this.toKey(filePath)
    if (!key) return
    try {
      const res = await this.signedFetch('DELETE', key, {}, undefined, undefined, 30000)
      if (res.status === 404) return
      if (res.status === 401 || res.status === 403) {
        throw new AppError('S3_CONNECTION_FAILED', 'Account lacks permission to delete file')
      }
      if (!res.ok && res.status !== 200 && res.status !== 204) {
        throw new AppError('S3_CONNECTION_FAILED', `Failed to delete remote file (HTTP ${res.status})`)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to delete file from S3: ${message}`)
    }
  }

  async exists(filePath: string, isDir = false): Promise<boolean> {
    try {
      if (isDir) {
        const { prefix } = this.listPrefixFor(filePath)
        const res = await this.signedFetch('GET', null, {
          'list-type': '2',
          delimiter: '/',
          'max-keys': '1',
          prefix,
        }, undefined, undefined, 10000)
        if (!res.ok) return false
        const parsed = parseListObjectsV2Xml(await res.text())
        return parsed.prefixes.length > 0 || parsed.contents.length > 0
      }
      const key = this.toKey(filePath)
      if (!key) return false
      const res = await this.signedFetch('HEAD', key, {}, undefined, undefined, 10000)
      if (res.status === 200) return true
      return false
    } catch {
      return false
    }
  }

  async size(filePath: string): Promise<number> {
    const key = this.toKey(filePath)
    if (!key) throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
    try {
      const res = await this.signedFetch('HEAD', key, {}, undefined, undefined, 10000)
      if (res.ok) {
        const len = res.headers.get('content-length')
        if (len !== null) return parseInt(len, 10) || 0
      }
      if (res.status === 404) {
        throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      const { prefix } = this.listPrefixFor(filePath.split('/').slice(0, -1).join('/') || '/')
      const listRes = await this.signedFetch('GET', null, {
        'list-type': '2',
        delimiter: '/',
        'max-keys': String(MAX_LIST_KEYS),
        prefix,
      }, undefined, undefined, 10000)
      if (listRes.ok) {
        const parsed = parseListObjectsV2Xml(await listRes.text())
        const hit = parsed.contents.find((c) => c.key === key)
        if (hit) return hit.size
      }
      const { size } = await this.download(filePath)
      return size
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to get remote file size: ${message}`)
    }
  }

  async getStream(filePath: string, range?: { start: number; end: number }): Promise<Readable> {
    const key = this.toKey(filePath)
    if (!key) throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
    const headers: Record<string, string> = {}
    if (range) headers.Range = `bytes=${range.start}-${range.end}`
    try {
      const res = await this.signedFetch('GET', key, {}, undefined, headers, 60000)
      if (res.status === 404 || res.status === 416) {
        throw new AppError('S3_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      if (!res.ok && res.status !== 206) {
        throw new AppError('S3_CONNECTION_FAILED', `Failed to stream remote file (HTTP ${res.status})`)
      }
      if (!res.body) {
        throw new AppError('S3_CONNECTION_FAILED', 'Empty response stream from S3 storage')
      }
      return Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Failed to stream file from S3: ${message}`)
    }
  }

  async testStorageProbe(basePath: string): Promise<{ success: boolean; latencyMs: number }> {
    const startTime = Date.now()
    const cleanBasePath = '/' + basePath.replace(/^\/+|\/+$/g, '')
    try {
      await this.mkdir(cleanBasePath)
      const probeName = `.probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const probePath = `${cleanBasePath}/${probeName}`
      await this.upload(probePath, Buffer.from('bookdock-probe'))
      await this.delete(probePath)
      return { success: true, latencyMs: Date.now() - startTime }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('S3_CONNECTION_FAILED', `Storage probe failed: ${message}`)
    }
  }
}
