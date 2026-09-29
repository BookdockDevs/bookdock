import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPut } from '@/api/client'
import { reportBrowserTimezone } from '@/features/auth/report-timezone'

vi.mock('@/api/client', () => ({ apiPut: vi.fn(async () => ({ data: { ok: true } })) }))

describe('reportBrowserTimezone', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(apiPut).mockClear()
  })

  it('sends the browser zone once per tab and not again for the same zone', async () => {
    await reportBrowserTimezone('u1')
    expect(apiPut).toHaveBeenCalledWith('/auth/timezone', { timezone: 'Asia/Shanghai' })

    await reportBrowserTimezone('u1')
    expect(apiPut).toHaveBeenCalledTimes(1)
  })

  it('keys the guard per user so switching accounts does not skip the report', async () => {
    await reportBrowserTimezone('u1')
    await reportBrowserTimezone('u2')
    expect(apiPut).toHaveBeenCalledTimes(2)
  })

  it('leaves the marker unset after a failure so the next mount retries', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new Error('offline'))
    await expect(reportBrowserTimezone('u1')).rejects.toThrow('offline')
    expect(sessionStorage.getItem('bd-timezone:u1')).toBeNull()

    await reportBrowserTimezone('u1')
    expect(apiPut).toHaveBeenCalledTimes(2)
  })
})
