import sharp from 'sharp'

import { log } from './logger'

/** Storage key of the WebP thumbnail derived from a cover key. */
export function coverThumbnailKey(coverKey: string): string {
  return coverKey.replace(/\.cover\.[^.]+$/, '.thumb.webp')
}

export function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length < 4) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) return 'gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  const header = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).replace(/^\uFEFF/, '')
  if (/<svg(?:\s|>)/i.test(header)) return 'svg'
  return null
}

export function blobKey(hash: string, ext: string): string {
  return `blobs/${hash.slice(0, 2)}/${hash}${ext}`
}

export async function generateCoverThumbnail(buffer: Buffer, ext?: string | null): Promise<Buffer | null> {
  const actualExt = ext || detectImageExtension(buffer)
  if (actualExt === 'svg') return buffer
  try {
    return await sharp(buffer)
      .resize({ width: 480, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
  } catch (err) {
    log('warn', 'cover_thumbnail_failed', { error: err })
    return null
  }
}
