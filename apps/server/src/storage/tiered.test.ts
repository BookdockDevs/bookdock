import { describe, expect, it, vi } from 'vitest'

import type { RemoteTierClient } from '../lib/remote-client'
import { TieredStorageDriver } from './tiered'
import { LocalFsDriver } from './localfs'

describe('tiered remote client factory', () => {
  it('keeps managed content local and propagates deletion failures for garbage collection retry', async () => {
    const put = vi.spyOn(LocalFsDriver.prototype, 'put').mockResolvedValue()
    const remove = vi.spyOn(LocalFsDriver.prototype, 'delete').mockRejectedValueOnce(new Error('locked')).mockResolvedValue()
    const remote: RemoteTierClient = {
      mkdir: vi.fn(), upload: vi.fn(), delete: vi.fn(), exists: vi.fn(), size: vi.fn(), getStream: vi.fn(),
    }
    try {
      const driver = new TieredStorageDriver(remote, '/storage', 2048)
      await driver.put('content/ab/hash.webp', Buffer.from('image'))
      expect(put).toHaveBeenCalledOnce()
      expect(remote.upload).not.toHaveBeenCalled()
      await expect(driver.delete('content/ab/hash.webp')).rejects.toThrow('locked')
      await driver.delete('content/ab/hash.webp')
      expect(remote.delete).not.toHaveBeenCalled()
    } finally { put.mockRestore(); remove.mockRestore() }
  })
})
