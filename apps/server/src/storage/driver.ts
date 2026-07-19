import type { Readable } from 'node:stream'

export interface StorageDriver {
  put(key: string, data: Buffer | Readable): Promise<void>
  get(key: string): Promise<Readable>
  getRange?(key: string, start: number, end?: number): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  size(key: string): Promise<number>
  getUrl?(key: string): Promise<string>
}
