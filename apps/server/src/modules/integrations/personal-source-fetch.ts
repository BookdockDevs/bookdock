import dns from 'node:dns'
import net from 'node:net'

import { AppError } from '../../middleware/error'
import { describeNetworkCause } from './metadata-http'

export interface PersonalSourceFetchInit {
  method?: string
  headers?: Record<string, unknown>
  body?: string
}

export interface PersonalSourceFetchResult {
  status: number
  body: string
}

const FETCH_TIMEOUT_MS = 10_000
const FETCH_BODY_MAX_BYTES = 2_000_000
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST'])

// The host performs every request on the sandbox's behalf, so a source can
// never open sockets itself — but it must also not be able to reach private
// infrastructure (loopback, LAN, link-local, docker networks) through us.
function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number) as [number, number, number, number]
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    return false
  }
  const lower = address.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
  const mapped = lower.startsWith('::ffff:')
    ? lower.slice(7)
    : lower.startsWith('0:0:0:0:0:ffff:')
      ? lower.slice(14)
      : null
  return mapped !== null && isPrivateAddress(mapped)
}

// Shared by the sandbox fetch host and personal-source cover import.
export async function assertPublicHttpsUrl(source: string): Promise<URL> {
  let url: URL
  try { url = new URL(source) } catch { throw new AppError('VALIDATION_ERROR', 'Invalid URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new AppError('VALIDATION_ERROR', 'URL must be a public https address')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: { address: string }[]
  try {
    addresses = await dns.promises.lookup(hostname, { all: true })
  } catch {
    throw new AppError('VALIDATION_ERROR', 'URL host could not be resolved')
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AppError('VALIDATION_ERROR', 'URL host is not a public address')
  }
  return url
}

// Responses are decoded with the charset they declare. The sandbox has no
// TextDecoder, so this is the only place a GBK/GB18030 source page can be
// decoded correctly — a source cannot compensate for mojibake afterwards.
export function decodeResponseText(bytes: Buffer, contentType: string | null): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  // HTML pages frequently declare the encoding only inside the document head.
  const sniffed = declared ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1]
  const label = sniffed?.toLowerCase()
  let text: string | undefined
  if (label && label !== 'utf-8' && label !== 'utf8') {
    try { text = new TextDecoder(label).decode(bytes) } catch { /* Unknown or unsupported label: fall back to UTF-8. */ }
  }
  return (text ?? bytes.toString('utf8')).replace(/^\uFEFF/, '')
}

export async function fetchThroughHost(url: string, init: PersonalSourceFetchInit = {}): Promise<PersonalSourceFetchResult> {
  const target = await assertPublicHttpsUrl(url)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) throw new AppError('VALIDATION_ERROR', 'Unsupported fetch method')
  if (init.body !== undefined && method !== 'POST') throw new AppError('VALIDATION_ERROR', 'Fetch body requires POST')
  const headers: Record<string, string> = { 'User-Agent': 'Bookdock/0.7 (https://github.com/BookdockDevs/bookdock)' }
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    const lowered = name.trim().toLowerCase()
    if (lowered === 'host' || lowered === 'content-length') continue
    if (typeof value === 'string' && value.length <= 2048) headers[name.trim()] = value
  }
  let response: Response
  try {
    response = await fetch(target, {
      method,
      headers,
      body: method === 'POST' ? init.body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `Metadata source request failed (${describeNetworkCause(err)})`)
  }
  const reader = response.body?.getReader()
  if (!reader) return { status: response.status, body: '' }
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > FETCH_BODY_MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'Metadata source response is too large')
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { status: response.status, body: decodeResponseText(Buffer.concat(parts), response.headers.get('content-type')) }
}
