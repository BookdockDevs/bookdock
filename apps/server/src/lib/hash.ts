import { createHash } from 'node:crypto'

/**
 * Fast content fingerprint for deduplication.
 *
 * Reads 1024-byte samples at exponential offsets, inspired by Readest's
 * partialMD5.  The sample pattern covers the head, tail, and a few points
 * in between — enough for a reliable dedup check without reading the
 * whole file.
 */
export function partialMD5(buffer: Buffer): string {
  const len = buffer.length
  const samples: Buffer[] = []

  // Head: first 1 KB
  samples.push(buffer.subarray(0, Math.min(1024, len)))

  if (len > 2048) {
    // Exponentially-spaced interior samples
    for (let step = 1024; step < len; step <<= 2) {
      const offset = Math.min(step, len - 1024)
      samples.push(buffer.subarray(offset, offset + 1024))
    }
  }

  // Tail: last 1 KB
  samples.push(buffer.subarray(Math.max(0, len - 1024)))

  const hash = createHash('md5')
  for (const s of samples) hash.update(s)
  return hash.digest('hex')
}

/**
 * Full SHA-256 for conflict resolution when partialMD5 collides.
 */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
