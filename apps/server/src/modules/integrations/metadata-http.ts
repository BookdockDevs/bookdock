import { AppError } from '../../middleware/error'

// Bounded, code-only description of why the outbound fetch failed (timeout,
// connection reset, DNS...). Never includes remote content.
export function describeNetworkCause(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown'
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined
  if (typeof cause?.code === 'string' && cause.code) return cause.code.replace(/\s+/g, ' ').slice(0, 60)
  // undici failures without a code still carry a concrete message
  // (e.g. "getaddrinfo ENOTFOUND example.com").
  if (typeof cause?.message === 'string' && cause.message.trim()) return cause.message.replace(/\s+/g, ' ').slice(0, 60)
  return err.name
}

export async function request(url: string, init: RequestInit = {}): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'Bookdock/0.7 (https://github.com/BookdockDevs/bookdock)', ...init.headers },
    })
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `Metadata source unavailable (${describeNetworkCause(err)})`)
  }
  if (!response.ok) throw new AppError('VALIDATION_ERROR', `Metadata source returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_000_000) throw new AppError('VALIDATION_ERROR', 'Metadata response is too large')
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(parts).toString('utf8')
}
