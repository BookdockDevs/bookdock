import fs from 'node:fs'
import path from 'node:path'

import { config } from '../../config'

/** Rebuildable on-disk cache for proxied builtin-font resources. Deliberately
 *  independent of StorageDriver: the tiered driver would queue these entries
 *  for the remote tier, but they are re-fetchable instance-local data with no
 *  cold value. Keys are `<fontId>/<version>/<package-relative path>` with every
 *  segment validated by the caller, so plain path joins are safe. There is no
 *  persisted index: after a restart the cache is rediscovered by scanning and
 *  any missing entry is simply re-fetched upstream. */

// Read lazily so test doubles can point the cache at a disposable directory.
function cacheRoot(): string {
  return path.join(config.dataDir, 'cache', 'font-shards')
}

function maxBytes(): number {
  return config.fontCacheMaxMb * 1024 * 1024
}

interface CacheEntry {
  bytes: number
  at: number
}

let index: Map<string, CacheEntry> | null = null

function loadIndex(): Map<string, CacheEntry> {
  if (index) return index
  index = new Map()
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      const key = path.relative(cacheRoot(), full).split(path.sep).join('/')
      try {
        const stat = fs.statSync(full)
        index!.set(key, { bytes: stat.size, at: stat.mtimeMs })
      } catch { /* raced removal */ }
    }
  }
  walk(cacheRoot())
  return index
}

function entryPath(key: string): string {
  return path.join(cacheRoot(), ...key.split('/'))
}

export function readFontCache(key: string): Buffer | null {
  const idx = loadIndex()
  try {
    const data = fs.readFileSync(entryPath(key))
    const entry = idx.get(key)
    if (entry) entry.at = Date.now()
    return data
  } catch {
    idx.delete(key)
    return null
  }
}

export function writeFontCache(key: string, data: Buffer): void {
  const idx = loadIndex()
  try {
    fs.mkdirSync(path.dirname(entryPath(key)), { recursive: true })
    const tmp = `${entryPath(key)}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, entryPath(key))
  } catch {
    // Cache write failures never fail the request; the entry stays fetchable.
    return
  }
  idx.set(key, { bytes: data.length, at: Date.now() })
  evict(idx)
}

function evict(idx: Map<string, CacheEntry>): void {
  let total = 0
  for (const entry of idx.values()) total += entry.bytes
  if (total <= maxBytes()) return
  const oldest = [...idx.entries()].sort((left, right) => left[1].at - right[1].at)
  for (const [key, entry] of oldest) {
    if (total <= maxBytes()) break
    try {
      fs.unlinkSync(entryPath(key))
    } catch { /* already gone */ }
    idx.delete(key)
    total -= entry.bytes
  }
}

/** Test helper: drop the in-memory index so a fresh data dir is rescanned. */
export function resetFontCacheForTest(): void {
  index = null
}
