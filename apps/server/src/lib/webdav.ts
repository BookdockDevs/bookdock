import { Readable } from 'node:stream'

import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom'
import type { WebDavEntry } from '@bookdock/shared'
import { AppError } from '../middleware/error'
import type { RemoteBrowseClient } from './remote-client'

export interface WebDavClientConfig {
  url: string
  username: string
  password?: string
  basePath: string
}

function decodeSafeUri(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

export function buildRemoteUrl(serverUrl: string, basePath: string, subPath: string, isDir = false): URL {
  if (subPath.includes('..') || basePath.includes('..')) {
    throw new AppError('VALIDATION_ERROR', 'Path traversal is not allowed')
  }

  let base: URL
  try {
    base = new URL(serverUrl)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid WebDAV server URL')
  }

  // Deconstruct path segments from serverUrl pathname, basePath, and subPath
  const serverSegments = base.pathname.split('/').map(decodeSafeUri).filter(Boolean)
  const baseSegments = basePath.split('/').map(decodeSafeUri).filter(Boolean)
  const subSegments = subPath.split('/').map(decodeSafeUri).filter(Boolean)

  const allSegments = [...serverSegments, ...baseSegments, ...subSegments]
  const encodedPath = allSegments.map(encodeURIComponent).join('/')
  const trailingSlash = (isDir || subPath.endsWith('/') || (subSegments.length === 0 && (basePath.endsWith('/') || base.pathname.endsWith('/')))) ? '/' : ''

  base.pathname = '/' + encodedPath + (encodedPath && trailingSlash ? '/' : (encodedPath ? '' : '/'))
  return base
}

export function basicAuthHeader(username: string, password = ''): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
}

function matchesLocalName(node: unknown, expectedName: string): boolean {
  if (!node || typeof node !== 'object' || !('nodeType' in node) || (node as { nodeType: number }).nodeType !== 1) {
    return false
  }
  const el = node as XmlElement
  const local = el.localName || el.tagName.replace(/^.*:/, '')
  return local.toLowerCase() === expectedName.toLowerCase()
}

function findFirstDirectChild(parent: XmlElement, name: string): XmlElement | null {
  if (!parent.childNodes) return null
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i)
    if (child && matchesLocalName(child, name)) {
      return child as XmlElement
    }
  }
  return null
}

function findDescendants(parent: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = []
  if (!parent.childNodes) return result
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i)
    if (child && (child as { nodeType: number }).nodeType === 1) {
      if (matchesLocalName(child, name)) {
        result.push(child as XmlElement)
      }
      result.push(...findDescendants(child as XmlElement, name))
    }
  }
  return result
}

function getTextContent(el: XmlElement | null): string {
  if (!el || !el.textContent) return ''
  return el.textContent.trim()
}

export function parsePropfindXml(xmlText: string, requestedPath: string, maxSizeBytes?: number | null): WebDavEntry[] {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xmlText, 'text/xml')

  const root = doc.documentElement
  if (!root) return []

  const responseElements = findDescendants(root, 'response')
  const entries: WebDavEntry[] = []

  const cleanReqPath = requestedPath.replace(/^\/+|\/+$/g, '')

  let rootDecodedHref: string | null = null

  for (let i = 0; i < responseElements.length; i++) {
    const resp = responseElements[i]
    const hrefEl = findFirstDirectChild(resp, 'href')
    if (!hrefEl) continue
    const rawHref = getTextContent(hrefEl)
    if (!rawHref) continue

    let hrefPath = rawHref
    if (hrefPath.startsWith('http://') || hrefPath.startsWith('https://')) {
      try {
        hrefPath = new URL(hrefPath).pathname
      } catch {
        // fallback to rawHref
      }
    }
    const decodedHref = decodeSafeUri(hrefPath).replace(/\/+$/, '')
    const hrefSegments = decodedHref.split('/').filter(Boolean)
    if (hrefSegments.length === 0) continue

    const name = hrefSegments[hrefSegments.length - 1]
    if (!name) continue

    // Determine if it is a directory
    const resourceTypeEls = findDescendants(resp, 'resourcetype')
    let isDir = false
    for (const rt of resourceTypeEls) {
      if (findDescendants(rt, 'collection').length > 0) {
        isDir = true
        break
      }
    }

    // In RFC 4918 Depth: 1 responses, the targeted resource itself is reported first
    if (i === 0 && isDir) {
      rootDecodedHref = decodedHref
      continue
    }
    if (rootDecodedHref && decodedHref === rootDecodedHref) {
      continue
    }

    // Size
    let size = 0
    const contentLengthEls = findDescendants(resp, 'getcontentlength')
    if (contentLengthEls.length > 0) {
      const parsedSize = parseInt(getTextContent(contentLengthEls[0]), 10)
      if (!Number.isNaN(parsedSize) && parsedSize >= 0) {
        size = parsedSize
      }
    }

    // Last modified
    let updatedAt: number | undefined
    const lastModifiedEls = findDescendants(resp, 'getlastmodified')
    if (lastModifiedEls.length > 0) {
      const parsedTime = Date.parse(getTextContent(lastModifiedEls[0]))
      if (!Number.isNaN(parsedTime)) {
        updatedAt = parsedTime
      }
    }

    const itemPath = cleanReqPath ? `/${cleanReqPath}/${name}` : `/${name}`
    const lowerName = name.toLowerCase()
    const isSupportedFormat = !isDir && (lowerName.endsWith('.epub') || lowerName.endsWith('.txt'))
    const withinSize = typeof maxSizeBytes === 'number' && maxSizeBytes > 0 ? size <= maxSizeBytes : true

    entries.push({
      name,
      path: itemPath,
      type: isDir ? 'dir' : 'file',
      size,
      updatedAt,
      isSupported: isSupportedFormat && withinSize,
    })
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

  return entries
}

export class WebDavClient implements RemoteBrowseClient {
  constructor(private readonly config: WebDavClientConfig) {}

  async testConnection(): Promise<{ success: boolean; latencyMs: number }> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, '/', true)
    const startTime = Date.now()

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
          Depth: '0',
          'Content-Type': 'application/xml; charset="utf-8"',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (res.status === 401 || res.status === 403) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Authentication failed (verify username and password)')
      }
      if (res.status === 404) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'WebDAV path not found (verify URL and basePath)')
      }
      if (!res.ok && res.status !== 207) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `WebDAV server returned HTTP ${res.status}`)
      }

      return { success: true, latencyMs: Date.now() - startTime }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Cannot connect to WebDAV server: ${message}`)
    }
  }

  async list(subPath = '/', maxSizeBytes?: number | null): Promise<WebDavEntry[]> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, subPath, true)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
          Depth: '1',
          'Content-Type': 'application/xml; charset="utf-8"',
        },
        signal: AbortSignal.timeout(15000),
      })

      if (res.status === 401 || res.status === 403) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Authentication failed (verify username and password)')
      }
      if (res.status === 404) {
        throw new AppError('WEBDAV_FILE_NOT_FOUND', `Directory not found: ${subPath}`)
      }
      if (!res.ok && res.status !== 207) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `WebDAV server returned HTTP ${res.status}`)
      }

      const xmlText = await res.text()
      return parsePropfindXml(xmlText, subPath, maxSizeBytes)
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to list directory: ${message}`)
    }
  }

  async download(filePath: string): Promise<{ buffer: Buffer; name: string; size: number }> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, false)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
        },
        signal: AbortSignal.timeout(60000),
      })

      if (res.status === 404) {
        throw new AppError('WEBDAV_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      if (!res.ok) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to download file (HTTP ${res.status})`)
      }

      const arrayBuffer = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const segments = filePath.split('/').filter(Boolean)
      const name = segments[segments.length - 1] || 'book'

      return { buffer, name, size: buffer.length }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to download file: ${message}`)
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const segments = dirPath.split('/').filter(Boolean)
    let currentPath = ''
    for (const segment of segments) {
      currentPath += '/' + segment
      // Skip if directory already exists (e.g. Alist mount point or pre-created folder)
      if (await this.exists(currentPath, true)) {
        continue
      }
      const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, currentPath, true)
      try {
        const res = await fetch(targetUrl.toString(), {
          method: 'MKCOL',
          headers: {
            Authorization: basicAuthHeader(this.config.username, this.config.password),
          },
          signal: AbortSignal.timeout(15000),
        })

        // 201 Created is normal.
        // 405 (Method Not Allowed) or 409 (Conflict) or 200 (OK) are common responses
        // when directory already exists on servers like Alist, Nutstore, Synology.
        if (res.status === 201 || res.status === 405 || res.status === 409 || res.status === 200) {
          continue
        }
        if (res.status === 401 || res.status === 403) {
          if (await this.exists(currentPath, true)) {
            continue
          }
          throw new AppError('WEBDAV_CONNECTION_FAILED', 'Account lacks permission to create directory')
        }
        if (!res.ok) {
          throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to create directory ${currentPath} (HTTP ${res.status})`)
        }
      } catch (err) {
        if (err instanceof AppError) throw err
        const message = err instanceof Error ? err.message : String(err)
        throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to create directory ${currentPath}: ${message}`)
      }
    }
  }

  async upload(filePath: string, data: Buffer | Uint8Array | NodeJS.ReadableStream): Promise<void> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, false)
    const isNodeStream = Boolean(data && typeof (data as NodeJS.ReadableStream).pipe === 'function')
    const bodyPayload = isNodeStream ? (Readable.toWeb(data as Readable) as unknown as BodyInit) : (data as unknown as BodyInit)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'PUT',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
          'Content-Type': 'application/octet-stream',
        },
        body: bodyPayload,
        // @ts-expect-error duplex is required by Node fetch when streaming request body
        duplex: isNodeStream ? 'half' : undefined,
        signal: AbortSignal.timeout(120000),
      })

      if (res.status === 401 || res.status === 403) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Account lacks permission to upload file')
      }
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to upload file (HTTP ${res.status})`)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to upload file to WebDAV: ${message}`)
    }
  }

  async delete(filePath: string): Promise<void> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, false)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'DELETE',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
        },
        signal: AbortSignal.timeout(30000),
      })

      // 404 is considered success (already gone)
      if (res.status === 404) return
      if (res.status === 401 || res.status === 403) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Account lacks permission to delete file')
      }
      if (!res.ok && res.status !== 204) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to delete remote file (HTTP ${res.status})`)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to delete file from WebDAV: ${message}`)
    }
  }

  async exists(filePath: string, isDir = false): Promise<boolean> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, isDir)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
          Depth: '0',
          'Content-Type': 'application/xml; charset="utf-8"',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (res.status === 200 || res.status === 207) return true
      if (res.status === 404) return false

      // Fallback only if server explicitly rejects PROPFIND (HTTP 405 / 501)
      if (res.status === 405 || res.status === 501) {
        const headRes = await fetch(targetUrl.toString(), {
          method: 'HEAD',
          headers: {
            Authorization: basicAuthHeader(this.config.username, this.config.password),
          },
          signal: AbortSignal.timeout(10000),
        })
        return headRes.ok
      }

      return false
    } catch {
      return false
    }
  }

  async size(filePath: string): Promise<number> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, false)

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'HEAD',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
        },
        signal: AbortSignal.timeout(10000),
      })

      if (res.ok) {
        const len = res.headers.get('content-length')
        if (len !== null) return parseInt(len, 10) || 0
      }

      // Prefer PROPFIND getcontentlength over downloading the whole file
      const propRes = await fetch(targetUrl.toString(), {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuthHeader(this.config.username, this.config.password),
          Depth: '0',
          'Content-Type': 'application/xml; charset="utf-8"',
        },
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns:D="DAV:"><D:prop><D:getcontentlength/></D:prop></propfind>',
        signal: AbortSignal.timeout(10000),
      })
      if (propRes.status === 404) {
        throw new AppError('WEBDAV_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      if (propRes.ok || propRes.status === 207) {
        const xmlText = await propRes.text()
        const match = xmlText.match(/<[^>]*getcontentlength[^>]*>(\d+)<\/[^>]*getcontentlength[^>]*>/i)
        if (match) return parseInt(match[1], 10) || 0
      }

      // Last resort: download
      const { size } = await this.download(filePath)
      return size
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to get remote file size: ${message}`)
    }
  }

  async getStream(filePath: string, range?: { start: number; end: number }): Promise<Readable> {
    const targetUrl = buildRemoteUrl(this.config.url, this.config.basePath, filePath, false)
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(this.config.username, this.config.password),
    }
    if (range) {
      headers.Range = `bytes=${range.start}-${range.end}`
    }

    try {
      const res = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(60000),
      })

      if (res.status === 404) {
        throw new AppError('WEBDAV_FILE_NOT_FOUND', `Remote file not found: ${filePath}`)
      }
      if (!res.ok && res.status !== 206) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to stream remote file (HTTP ${res.status})`)
      }
      if (!res.body) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Empty response stream from WebDAV server')
      }

      return Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Failed to stream file from WebDAV: ${message}`)
    }
  }

  async testStorageProbe(basePath: string): Promise<{ success: boolean; latencyMs: number }> {
    const startTime = Date.now()
    const cleanBasePath = '/' + basePath.replace(/^\/+|\/+$/g, '')

    try {
      // 1. Ensure directory exists or create recursively
      await this.mkdir(cleanBasePath)

      // 2. Upload test probe
      const probeName = `.probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const probePath = `${cleanBasePath}/${probeName}`
      await this.upload(probePath, Buffer.from('bookdock-probe'))

      // 3. Clean up probe
      await this.delete(probePath)

      return { success: true, latencyMs: Date.now() - startTime }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('permission') || message.includes('403')) {
        throw new AppError('WEBDAV_CONNECTION_FAILED', 'Account lacks permission to write or delete files in the target directory')
      }
      throw new AppError('WEBDAV_CONNECTION_FAILED', `Storage probe failed: ${message}`)
    }
  }
}

