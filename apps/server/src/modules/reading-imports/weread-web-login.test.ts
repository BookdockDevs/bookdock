import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../../middleware/error'
import { createWereadQrChallenge, finishWereadQrLogin } from './weread-web-login'

const fetchMock = vi.fn()

function jsonResponse(payload: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(payload), { status: 200, headers })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeRead QR login', () => {
  it('creates a WeRead confirmation URL from the issued uid', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ uid: 'one-time-uid' }, ['login_bootstrap=1; Path=/']))

    const challenge = await createWereadQrChallenge()

    expect(challenge).toEqual({
      uid: 'one-time-uid',
      confirmUrl: 'https://weread.qq.com/web/confirm?pf=2&uid=one-time-uid',
      cookies: new Map([['login_bootstrap', '1']]),
    })
    expect(fetchMock).toHaveBeenCalledWith('https://weread.qq.com/web/login/getuid', expect.objectContaining({ method: 'POST' }))
  })

  it('completes the login exchange and returns only the required cookies', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ scan: 1 }))
      .mockResolvedValueOnce(jsonResponse({
        vid: 306734116,
        skey: 'temporary-session-key',
        code: 'temporary-login-code',
        redirect_uri: 'ignored',
        expireMode: 1,
        pf: 2,
      }, ['scan_state=consumed; Path=/']))
      .mockResolvedValueOnce(jsonResponse({ succ: 1 }))
      .mockResolvedValueOnce(jsonResponse({ succ: 1 }, [
        'wr_vid=306734116; Path=/; HttpOnly; Secure',
        'wr_skey=final-secret; Path=/; HttpOnly; Secure',
        'wr_rt=refresh-secret; Path=/; HttpOnly; Secure',
      ]))

    const credential = await finishWereadQrLogin('one-time-uid', new AbortController().signal, new Map([['login_bootstrap', '1']]))

    expect(credential).toEqual({ vid: '306734116', skey: 'final-secret' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const webloginBody = JSON.parse(String(fetchMock.mock.calls[2]![1]!.body)) as Record<string, unknown>
    expect(webloginBody).toMatchObject({ vid: 306734116, skey: 'temporary-session-key', code: 'temporary-login-code', fp: '' })
    expect(webloginBody).not.toHaveProperty('redirect_uri')
    expect(webloginBody).not.toHaveProperty('expireMode')
    expect(webloginBody).not.toHaveProperty('pf')
    expect(fetchMock.mock.calls[3]![0]).toBe('https://weread.qq.com/web/login/session/init')
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).Cookie).toBe('login_bootstrap=1')
    expect((fetchMock.mock.calls[3]![1]!.headers as Record<string, string>).Cookie).toBe('login_bootstrap=1; scan_state=consumed')
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1]!.body))).toEqual({
      vid: '306734116', pf: 0, skey: 'temporary-session-key', rt: 'temporary-login-code',
    })
  })

  it('rejects a completed exchange that did not issue both required cookies', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ vid: 306734116, skey: 'a', code: 'r' }))
      .mockResolvedValueOnce(jsonResponse({ succ: 1 }))
      .mockResolvedValueOnce(jsonResponse({ succ: 1 }, ['wr_vid=306734116; Path=/']))

    await expect(finishWereadQrLogin('one-time-uid', new AbortController().signal))
      .rejects.toMatchObject({ code: 'WEREAD_QR_LOGIN_FAILED' })
  })

  it('maps upstream login errors to a non-sensitive application error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errCode: -1, errMsg: 'private upstream detail' }))

    await expect(createWereadQrChallenge()).rejects.toBeInstanceOf(AppError)
  })
})
