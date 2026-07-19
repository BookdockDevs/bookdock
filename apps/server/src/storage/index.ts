import { config } from '../config'
import { LocalFsDriver } from './localfs'
import type { StorageDriver } from './driver'

let _storage: StorageDriver | null = null

export function getStorage(): StorageDriver {
  if (_storage) return _storage
  switch (config.storageDriver) {
    case 'localfs':
      _storage = new LocalFsDriver()
      break
    default:
      throw new Error(`Unknown storage driver: ${config.storageDriver}`)
  }
  return _storage
}
