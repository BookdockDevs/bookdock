import { config } from '../config'
import { LocalFsDriver } from './localfs'
import { createTieredDriverFromDb } from './tiered'
import type { StorageDriver } from './driver'

let _storage: StorageDriver | null = null

export function resetStorage(): void {
  _storage = null
}

export function getStorage(): StorageDriver {
  if (_storage) return _storage

  try {
    const tiered = createTieredDriverFromDb()
    if (tiered) {
      _storage = tiered
      return _storage
    }
  } catch {
    // Fall back to configured driver if DB is not ready
  }

  switch (config.storageDriver) {
    case 'localfs':
      _storage = new LocalFsDriver()
      break
    default:
      throw new Error(`Unknown storage driver: ${config.storageDriver}`)
  }
  return _storage
}

