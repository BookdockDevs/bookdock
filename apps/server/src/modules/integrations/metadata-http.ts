import { AppError } from '../../middleware/error'

export async function request(url: string, init: RequestInit = {}): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'Bookdock/0.7 (https://github.com/BookdockDevs/bookdock)', ...init.headers },
    })
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Metadata source unavailable')
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
