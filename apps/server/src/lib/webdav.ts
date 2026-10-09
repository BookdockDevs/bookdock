import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom'
import type { WebDavEntry } from '@bookdock/shared'
import { AppError } from '../middleware/error'

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

export class WebDavClient {
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
}
