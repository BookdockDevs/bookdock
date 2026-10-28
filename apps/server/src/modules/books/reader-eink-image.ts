import sharp from 'sharp'

import { AppError } from '../../middleware/error'

const MAX_EDGE = 1200
const MAX_INPUT_PIXELS = 40_000_000
const CACHE_BYTES = 24 * 1024 * 1024
const CACHE_ITEMS = 64
const MAX_ACTIVE = 2
const MAX_WAITING = 16

const cache = new Map<string, Buffer>()
const inFlight = new Map<string, Promise<Buffer>>()
const waiting: Array<() => void> = []
let cacheBytes = 0
let active = 0

export async function einkImage(key: string, data: Buffer): Promise<Buffer> {
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const existing = inFlight.get(key)
  if (existing) return existing
  if (active >= MAX_ACTIVE && waiting.length >= MAX_WAITING) throw new AppError('READER_ENTRY_FAILED', 'Image conversion is busy; retry')

  const task = (async () => {
    if (active >= MAX_ACTIVE) await new Promise<void>(resolve => waiting.push(resolve))
    else active++
    try {
      const input = sharp(data, { animated: true, limitInputPixels: MAX_INPUT_PIXELS })
      const metadata = await input.metadata()
      const width = metadata.width ?? 0
      const height = metadata.pageHeight ?? metadata.height ?? 0
      const pages = metadata.pages ?? 1
      if (!width || !height || width * height * pages > MAX_INPUT_PIXELS) throw new Error('Image dimensions exceed the e-ink limit')
      if (width <= MAX_EDGE && height <= MAX_EDGE) return data
      if (pages > 1) throw new Error('Oversized animated images are not supported')
      if (!metadata.format || !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) throw new Error('Unsupported image format')
      const output = await input.rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }).toFormat(metadata.format as 'jpeg' | 'png' | 'webp' | 'gif').toBuffer()
      if (output.length <= CACHE_BYTES) {
        cache.set(key, output)
        cacheBytes += output.length
        while (cacheBytes > CACHE_BYTES || cache.size > CACHE_ITEMS) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cacheBytes -= cache.get(oldest)!.length
          cache.delete(oldest)
        }
      }
      return output
    } catch {
      throw new AppError('READER_ENTRY_FAILED', 'Image could not be prepared for e-ink')
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  })()
  inFlight.set(key, task)
  try { return await task } finally { if (inFlight.get(key) === task) inFlight.delete(key) }
}
