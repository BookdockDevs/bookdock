import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookListRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { invalidateReaderSession } from '@/lib/session-scope'

import { guardedRemoteCatalogRead } from './remote-catalog'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn() }))

const path = '/books?page=1&pageSize=24&sortBy=title&sortOrder=asc'
const row: BookListRes['data'][number] = { id: 'same-id', title: 'Remote', author: 'Author', authors: ['Author'], format: 'epub', coverKey: null, size: 3, readStatus: 'reading', progress: 42, shelfId: null, createdAt: 1, updatedAt: 1, effectiveHidden: false, hiddenReason: null }
const response: BookListRes = { data: [row], total: 1, totalSize: 3, page: 1, pageSize: 24 }

beforeEach(() => { vi.mocked(apiGet).mockReset() })

describe('guarded remote catalog read', () => {
  it('returns the response the server sent', async () => {
    vi.mocked(apiGet).mockResolvedValue(response)
    await expect(guardedRemoteCatalogRead<BookListRes>(path)).resolves.toBe(response)
    expect(apiGet).toHaveBeenCalledWith(path, undefined)
  })

  it('does not turn denied access into a permissive fallback', async () => {
    const refusal = new Error('Permission denied')
    vi.mocked(apiGet).mockRejectedValue(refusal)
    await expect(guardedRemoteCatalogRead(path)).rejects.toBe(refusal)
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('drops a reply that lands after an account or permission change', async () => {
    let finish!: (value: BookListRes) => void
    vi.mocked(apiGet).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = guardedRemoteCatalogRead<BookListRes>(path)
    invalidateReaderSession()
    finish(response)
    await expect(pending).rejects.toThrow()
  })

  it('refuses before transport when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(guardedRemoteCatalogRead(path, controller.signal)).rejects.toThrow()
    expect(apiGet).not.toHaveBeenCalled()
  })
})
