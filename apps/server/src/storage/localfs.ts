import { promises as fs, createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StorageDriver } from './driver'
import { config } from '../config'

export class LocalFsDriver implements StorageDriver {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(config.dataDir, 'files')
  }

  private resolve(key: string): string {
    const resolved = path.join(this.baseDir, key)
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Invalid key: path traversal detected')
    }
    return resolved
  }

  async put(key: string, data: Buffer | Readable): Promise<void> {
    const filePath = this.resolve(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    // Atomic write: write to .tmp, then rename
    const tmpPath = filePath + '.tmp.' + randomUUID()
    try {
      if (Buffer.isBuffer(data)) {
        await fs.writeFile(tmpPath, data)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of data) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        await fs.writeFile(tmpPath, Buffer.concat(chunks))
      }
      await fs.rename(tmpPath, filePath)
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {})
      throw err
    }
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.resolve(key))
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key)
    await fs.unlink(filePath)
    // Clean up empty parent directories
    let dir = path.dirname(filePath)
    while (dir.startsWith(this.baseDir)) {
      try {
        const entries = await fs.readdir(dir)
        if (entries.length > 0) break
        await fs.rmdir(dir)
        dir = path.dirname(dir)
      } catch {
        break
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }

  async size(key: string): Promise<number> {
    const stat = await fs.stat(this.resolve(key))
    return stat.size
  }
}
