import type { Readable } from 'node:stream'

import type { WebDavEntry } from '@bookdock/shared'

export interface RemoteTierClient {
  mkdir(dirPath: string): Promise<void>
  upload(filePath: string, data: Buffer | Uint8Array | NodeJS.ReadableStream): Promise<void>
  delete(filePath: string): Promise<void>
  exists(filePath: string, isDir?: boolean): Promise<boolean>
  size(filePath: string): Promise<number>
  getStream(filePath: string, range?: { start: number; end: number }): Promise<Readable>
  getRange?(filePath: string, range: { start: number; end: number }): Promise<{ data: Buffer; size: number } | null>
}

/** An ignored or malformed Range must never be served as a valid partial file. */
export async function readRemoteRange(response: Response, range: { start: number; end: number }): Promise<{ data: Buffer; size: number } | null> {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
  const start = Number(match?.[1])
  const end = Number(match?.[2])
  const size = Number(match?.[3])
  if (response.status !== 206 || !match || !Number.isSafeInteger(size) || size <= 0
    || start !== range.start || end !== Math.min(range.end, size - 1) || end < start) {
    await response.body?.cancel()
    return null
  }
  const expected = end - start + 1
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > expected) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return received === expected ? { data: Buffer.concat(chunks), size } : null
  } finally {
    reader.releaseLock()
  }
}

export interface RemoteBrowseClient extends RemoteTierClient {
  testConnection(): Promise<{ success: boolean; latencyMs: number }>
  list(subPath?: string, maxSizeBytes?: number | null): Promise<WebDavEntry[]>
  download(filePath: string): Promise<{ buffer: Buffer; name: string; size: number }>
  testStorageProbe(basePath: string): Promise<{ success: boolean; latencyMs: number }>
}
