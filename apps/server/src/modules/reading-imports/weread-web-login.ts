import type { WereadQrLoginFailure } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import type { WereadWebCredential } from './weread-web'

const WEREAD_ORIGIN = 'https://weread.qq.com'
const LOGIN_TIMEOUT_MS = 115_000
const WEB_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

type JsonObject = Record<string, unknown>
type LoginStage = 'getuid' | WereadQrLoginFailure['stage']

export class WereadQrLoginExchangeError extends AppError {
  constructor(public readonly failure: WereadQrLoginFailure) {
    super('WEREAD_QR_LOGIN_FAILED', 'WeRead QR login exchange failed')
    this.name = 'WereadQrLoginExchangeError'
  }
}

function exchangeError(stage: LoginStage, kind: WereadQrLoginFailure['kind'], extra: Pick<WereadQrLoginFailure, 'httpStatus' | 'upstreamCode' | 'observedFields'> = {}): WereadQrLoginExchangeError {
  return new WereadQrLoginExchangeError({ stage: stage === 'getuid' ? 'unknown' : stage, kind, ...extra })
}

function describeResponseShape(value: JsonObject, prefix = '', depth = 0, fields: string[] = []): string[] {
  for (const [key, child] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key) || fields.length >= 40) continue
    const path = prefix ? `${prefix}.${key}` : key
    const type = Array.isArray(child) ? 'array' : child === null ? 'null' : typeof child
    fields.push(`${path}:${type}`)
    if (isRecord(child) && depth < 2) describeResponseShape(child, path, depth + 1, fields)
  }
  return fields
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeSetCookies(jar: Map<string, string>, headers: Headers): void {
  for (const header of headers.getSetCookie()) {
    const pair = header.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
  }
}

async function loginPost(path: string, stage: LoginStage, body: JsonObject, jar: Map<string, string>, signal?: AbortSignal): Promise<JsonObject> {
  let response: Response
  try {
    response = await fetch(`${WEREAD_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: WEREAD_ORIGIN,
        Referer: `${WEREAD_ORIGIN}/`,
        'User-Agent': WEB_USER_AGENT,
        ...(jar.size > 0 ? { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(12_000),
    })
  } catch (error) {
    throw exchangeError(stage, error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network')
  }
  mergeSetCookies(jar, response.headers)
  if (!response.ok) throw exchangeError(stage, 'http', { httpStatus: response.status })

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw exchangeError(stage, 'invalid-json')
  }
  if (!isRecord(parsed)) throw exchangeError(stage, 'invalid-response')
  const errCode = typeof parsed.errCode === 'number' ? parsed.errCode : typeof parsed.errcode === 'number' ? parsed.errcode : 0
  if (errCode !== 0) throw exchangeError(stage, 'api-error', { upstreamCode: errCode })
  return parsed
}

export interface WereadQrChallenge {
  uid: string
  confirmUrl: string
  cookies: Map<string, string>
}

export async function createWereadQrChallenge(): Promise<WereadQrChallenge> {
  const cookies = new Map<string, string>()
  const response = await loginPost('/web/login/getuid', 'getuid', {}, cookies)
  if (typeof response.uid !== 'string' || !response.uid || response.uid.length > 256) {
    throw exchangeError('getuid', 'invalid-response')
  }
  const confirmUrl = new URL('/web/confirm', WEREAD_ORIGIN)
  confirmUrl.searchParams.set('pf', '2')
  confirmUrl.searchParams.set('uid', response.uid)
  return { uid: response.uid, confirmUrl: confirmUrl.toString(), cookies }
}

export async function finishWereadQrLogin(uid: string, signal: AbortSignal, initialCookies?: Map<string, string>): Promise<WereadWebCredential> {
  const jar = new Map(initialCookies)
  const loginSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  ])
  let loginInfoResponse: JsonObject
  let info: JsonObject
  while (true) {
    loginInfoResponse = await loginPost('/web/login/getinfo', 'getinfo', { uid }, jar, loginSignal)
    info = isRecord(loginInfoResponse.info) ? loginInfoResponse.info : loginInfoResponse
    if (typeof info.vid === 'number' || typeof info.vid === 'string') break
    if (typeof info.scan !== 'number') {
      throw exchangeError('getinfo', 'missing-credentials', { observedFields: describeResponseShape(loginInfoResponse) })
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(loginSignal.reason)
      }
      const timer = setTimeout(() => {
        loginSignal.removeEventListener('abort', onAbort)
        resolve()
      }, 500)
      loginSignal.addEventListener('abort', onAbort, { once: true })
    }).catch(() => {
      throw exchangeError('getinfo', 'timeout')
    })
  }

  if ((typeof info.vid !== 'number' && typeof info.vid !== 'string') || typeof info.skey !== 'string' || typeof info.code !== 'string') {
    throw exchangeError('getinfo', 'missing-credentials', { observedFields: describeResponseShape(loginInfoResponse) })
  }

  const webLoginInfo = { ...info }
  delete webLoginInfo.redirect_uri
  delete webLoginInfo.expireMode
  delete webLoginInfo.pf
  webLoginInfo.fp = ''
  await loginPost('/web/login/weblogin', 'weblogin', webLoginInfo, jar, loginSignal)

  await loginPost('/web/login/session/init', 'session-init', {
    vid: String(info.vid),
    pf: 0,
    skey: info.skey,
    rt: info.code,
  }, jar, loginSignal)

  const vid = jar.get('wr_vid')
  const skey = jar.get('wr_skey')
  if (!vid || !skey) throw exchangeError('session-init', 'missing-cookies')
  return { vid, skey }
}

