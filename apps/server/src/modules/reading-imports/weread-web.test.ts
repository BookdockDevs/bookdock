import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { AppError } from '../../middleware/error'
import {
  fetchBookReadInfo,
  fetchWereadWebApi,
  parseWereadCookie,
  probeWereadWebSession,
  readDayKey,
  serializeWereadCookie,
} from './weread-web'

const fetchMock = vi.fn()

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) } as Response
}

function readInfoPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    errCode: 0,
    readDetail: { data: [{ readDate: 1793376000, readTime: 3222 }] },
    readingTime: 24432,
    readingProgress: 48,
    markedStatus: 1,
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseWereadCookie', () => {
  it('keeps only wr_vid and wr_skey from a pasted Cookie header', () => {
    const credential = parseWereadCookie(
      'RK=abc; wr_fp=1; wr_skey=pmguPsOm; wr_vid=306734116; wr_rt=web%40x',
    )
    expect(credential).toEqual({ vid: '306734116', skey: 'pmguPsOm' })
  })

  it('accepts a whole request header line with its name', () => {
    const credential = parseWereadCookie('Cookie: wr_vid=42; wr_skey=sk')
    expect(credential).toEqual({ vid: '42', skey: 'sk' })
  })

  it('rejects a header without both required cookies', () => {
    expect(() => parseWereadCookie('wr_vid=42; other=1')).toThrowError(AppError)
    expect(() => parseWereadCookie('   ')).toThrowError(AppError)
  })
})

describe('serializeWereadCookie', () => {
  it('round-trips through parse', () => {
    const credential = { vid: '306734116', skey: 'pmguPsOm' }
    expect(parseWereadCookie(serializeWereadCookie(credential))).toEqual(credential)
  })
})

describe('readDayKey', () => {
  it('converts a UTC+8 midnight epoch second to its date', () => {
    expect(readDayKey(1793376000)).toBe('2026-10-31')
  })

  it('refuses non-positive and non-finite input', () => {
    expect(readDayKey(0)).toBeNull()
    expect(readDayKey(-1)).toBeNull()
    expect(readDayKey(Number.NaN)).toBeNull()
  })
})

describe('fetchBookReadInfo', () => {
  it('requests the daily breakdown with every opt-in flag and the session cookie', async () => {
    fetchMock.mockResolvedValue(jsonResponse(readInfoPayload()))

    await fetchBookReadInfo({ vid: '306734116', skey: 'pmguPsOm' }, 'CB_book1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://weread.qq.com/web/book/readinfo?')
    expect(url).toContain('bookId=CB_book1')
    expect(url).toContain('readingDetail=1')
    expect(url).toContain('readingBookIndex=1')
    expect(url).toContain('finishedDate=1')
    expect((init.headers as Record<string, string>).Cookie).toBe('wr_vid=306734116; wr_skey=pmguPsOm')
  })

  it('parses day buckets, totals and progress', async () => {
    fetchMock.mockResolvedValue(jsonResponse(readInfoPayload({
      readDetail: { data: [
        { readDate: 1793376000, readTime: 3222 },
        { readDate: 1793462400, readTime: 6752 },
      ] },
    })))

    const info = await fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1')
    expect(info.days).toEqual([
      { date: '2026-10-31', seconds: 3222 },
      { date: '2026-11-01', seconds: 6752 },
    ])
    expect(info.totalSeconds).toBe(24432)
    expect(info.progress).toBe(48)
    expect(info.finished).toBe(false)
    expect(info.finishedDate).toBeNull()
    expect(info.droppedDays).toBe(0)
  })

  it('flags finished books by markedStatus and keeps finishedDate only when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse(readInfoPayload({ markedStatus: 4, finishedDate: 1793376000 })))
    const finished = await fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1')
    expect(finished.finished).toBe(true)
    expect(finished.finishedDate).toBe('2026-10-31')

    fetchMock.mockResolvedValue(jsonResponse(readInfoPayload({ markedStatus: 1, finishedDate: 1793376000 })))
    const reading = await fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1')
    expect(reading.finished).toBe(false)
    // finishedDate arrived without the finished flag: still a usable date.
    expect(reading.finishedDate).toBe('2026-10-31')
  })

  it('drops days without a usable date or beyond 24 hours', async () => {
    fetchMock.mockResolvedValue(jsonResponse(readInfoPayload({
      readDetail: { data: [
        { readDate: 1793376000, readTime: 3222 },
        { readDate: 0, readTime: 100 },
        { readDate: 1793376000, readTime: 0 },
        { readDate: 1793376000, readTime: 90_000 },
        { readDate: 'garbage', readTime: 100 },
      ] },
    })))

    const info = await fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1')
    expect(info.days).toEqual([{ date: '2026-10-31', seconds: 3222 }])
    expect(info.droppedDays).toBe(4)
  })

  it('answers a bogus bookId with no days instead of an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errCode: 0, readDetail: { data: [] } }))
    const info = await fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_nope')
    expect(info.days).toEqual([])
    expect(info.totalSeconds).toBe(0)
  })

  it.each([
    [-2012, 'expired wr_skey'],
    [-2010, 'missing session'],
  ])('treats body errCode %i as an expired login, not an HTTP failure', async (errCode) => {
    fetchMock.mockResolvedValue(jsonResponse({ errCode, errMsg: '登录超时' }))
    await expect(fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1'))
      .rejects.toMatchObject({ code: 'WEREAD_WEB_AUTH_EXPIRED' })
  })

  it('treats an HTTP 401 as an expired login instead of a validation error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => '' } as Response)
    await expect(fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1'))
      .rejects.toMatchObject({ code: 'WEREAD_WEB_AUTH_EXPIRED' })
  })

  it('reports other body error codes and HTTP failures as validation errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errCode: -2003, errMsg: 'not registered' }))
    await expect(fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' } as Response)
    await expect(fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    // A non-object JSON body (e.g. `null`) fails the record check too.
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'null' } as Response)
    await expect(fetchBookReadInfo({ vid: '1', skey: 's' }, 'CB_book1'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('fetchWereadWebApi', () => {
  it('uses the Cookie V1 notebook, shelf, bookmark and review endpoints', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ books: [] }) } as Response)
    const credential = { vid: '306734116', skey: 'pmguPsOm' }

    await fetchWereadWebApi(credential, { api_name: '/user/notebooks' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://weread.qq.com/api/user/notebook')

    await fetchWereadWebApi(credential, { api_name: '/shelf/sync' })
    const [shelfUrl, shelfInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(shelfUrl).toBe('https://i.weread.qq.com/shelf/sync')
    expect(shelfInit.method).toBe('POST')
    expect(JSON.parse(String(shelfInit.body))).toEqual({ userVid: '306734116', synckey: 0 })

    await fetchWereadWebApi(credential, { api_name: '/book/bookmarklist', bookId: 'CB_book1' })
    expect(fetchMock.mock.calls[2]?.[0]).toContain('https://i.weread.qq.com/book/bookmarklist?bookId=CB_book1&type=1')

    await fetchWereadWebApi(credential, { api_name: '/review/list/mine', bookid: 'CB_book1', count: 50 })
    const [reviewUrl, reviewInit] = fetchMock.mock.calls[3] as [string, RequestInit]
    expect(reviewUrl).toContain('/web/review/list?')
    expect(reviewUrl).toContain('bookId=CB_book1')
    expect(reviewUrl).toContain('listType=11')
    expect(reviewUrl).toContain('mine=1')
    expect((reviewInit.headers as Record<string, string>).Cookie).toBe('wr_vid=306734116; wr_skey=pmguPsOm')
  })

  it('treats an HTTP 401 as an expired login instead of a validation error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response)
    await expect(fetchWereadWebApi({ vid: '1', skey: 's' }, { api_name: '/shelf/sync' }))
      .rejects.toMatchObject({ code: 'WEREAD_WEB_AUTH_EXPIRED' })
    await expect(fetchWereadWebApi({ vid: '1', skey: 's' }, { api_name: '/user/notebooks' }))
      .rejects.toMatchObject({ code: 'WEREAD_WEB_AUTH_EXPIRED' })
  })

  it('reports a rotated skey from Set-Cookie to the refresh callback', async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.append('Set-Cookie', 'wr_skey=rotated; Path=/; HttpOnly; Max-Age=5400')
    headers.append('Set-Cookie', 'wr_rt=web%40x; Path=/')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ books: [] }), { status: 200, headers }))

    const refreshed: Array<{ vid: string; skey: string }> = []
    await fetchWereadWebApi({ vid: '306734116', skey: 'pmguPsOm' }, { api_name: '/user/notebooks' }, (next) => refreshed.push(next))

    expect(refreshed).toEqual([{ vid: '306734116', skey: 'rotated' }])
  })

  it('does not invoke the refresh callback when the session did not rotate', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ books: [] }), { status: 200, headers: new Headers() }))

    const onRefresh = vi.fn()
    await fetchWereadWebApi({ vid: '306734116', skey: 'pmguPsOm' }, { api_name: '/user/notebooks' }, onRefresh)

    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('probeWereadWebSession', () => {
  it('answers valid on a clean notebook response and absorbs rotations', async () => {
    const headers = new Headers()
    headers.append('Set-Cookie', 'wr_skey=rotated; Path=/; HttpOnly')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errCode: 0, books: [] }), { status: 200, headers }))

    const refreshed: Array<{ vid: string; skey: string }> = []
    const result = await probeWereadWebSession({ vid: '306734116', skey: 'pmguPsOm' }, (next) => refreshed.push(next))

    expect(result).toBe('valid')
    expect(refreshed).toEqual([{ vid: '306734116', skey: 'rotated' }])
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://weread.qq.com/api/user/notebook')
  })

  it('answers expired only on definitive auth rejections', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errCode: -2012, errMsg: '登录超时' }), { status: 200 }))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('expired')

    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('expired')
  })

  it('answers unknown on network noise, odd statuses and unfamiliar bodies', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('unknown')

    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('unknown')

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errCode: -2003 }), { status: 200 }))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('unknown')

    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))
    expect(await probeWereadWebSession({ vid: '1', skey: 's' })).toBe('unknown')
  })
})
