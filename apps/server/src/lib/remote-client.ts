import type { Readable } from 'node:stream'

import type { WebDavEntry } from '@bookdock/shared'

export interface RemoteTierClient {
  mkdir(dirPath: string): Promise<void>
  upload(filePath: string, data: Buffer | Uint8Array | NodeJS.ReadableStream): Promise<void>
  delete(filePath: string): Promise<void>
  exists(filePath: string, isDir?: boolean): Promise<boolean>
  size(filePath: string): Promise<number>
  getStream(filePath: string, range?: { start: number; end: number }): Promise<Readable>
}

export interface RemoteBrowseClient extends RemoteTierClient {
  testConnection(): Promise<{ success: boolean; latencyMs: number }>
  list(subPath?: string, maxSizeBytes?: number | null): Promise<WebDavEntry[]>
  download(filePath: string): Promise<{ buffer: Buffer; name: string; size: number }>
  testStorageProbe(basePath: string): Promise<{ success: boolean; latencyMs: number }>
}
