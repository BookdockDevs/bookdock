import { AppError } from '../../middleware/error'
import { describeNetworkCause } from '../integrations/metadata-http'

/** The web reader authenticates with the whole login session, but only these
 * two cookies are needed to read. Keeping the allowlist here means a pasted
 * header cannot smuggle unrelated session cookies into storage. */
const REQUIRED_COOKIES = ['wr_vid', 'wr_skey'] as const

const READINFO_ENDPOINT = 'https://weread.qq.com/web/book/readinfo'

/** The web API answers a plain browser, so it must be asked as one. */
const WEB_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

/** A day cannot hold more than this; anything larger is a unit change or a
 * corrupt row, not reading. Same guard as the key channel (0.12 step 1). */
const MAX_DAY_SECONDS = 86_400

/** readDate is the epoch second of 00:00 on that day in UTC+8, so the date key
 * has to be derived in that zone rather than from the device locale. */
const CST_OFFSET_SECONDS = 8 * 3600

export interface WereadWebCredential {
  vid: string
  skey: string
}

export interface WereadReadDay {
  /** `YYYY-MM-DD` in UTC+8. */
  date: string
  seconds: number
}

export interface WereadBookReadInfo {
  days: WereadReadDay[]
  /** The book's cumulative seconds, as reported. Never used to fill gaps. */
  totalSeconds: number
  progress: number | null
  /** `markedStatus === 4`. `finishedDate` only exists for these books. */
  finished: boolean
  finishedDate: string | null
  /** Days dropped by the plausibility guard, for the sync report. */
  droppedDays: number
}

/** Accepts what the browser actually copies — the whole `Cookie` header, with
 * or without its name — and keeps only the two fields the API needs. */
export function parseWereadCookie(raw: string): WereadWebCredential {
  const header = raw.trim().replace(/^cookie\s*:\s*/i, '')
  if (!header) throw new AppError('VALIDATION_ERROR', 'WeRead cookie is empty')

  const values = new Map<string, string>()
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    // First occurrence wins: a browser header never repeats a name, and a
    // duplicate would only appear in hand-edited input.
    if (name && !values.has(name)) values.set(name, value)
  }

  const vid = values.get(REQUIRED_COOKIES[0])?.trim()
  const skey = values.get(REQUIRED_COOKIES[1])?.trim()
  if (!vid || !skey) {
    throw new AppError(
      'VALIDATION_ERROR',
      'WeRead cookie is missing wr_vid or wr_skey. Copy the whole Cookie header from a weread.qq.com request.',
    )
  }
  return { vid, skey }
}

export function serializeWereadCookie(credential: WereadWebCredential): string {
  return `wr_vid=${credential.vid}; wr_skey=${credential.skey}`
}

/** `YYYY-MM-DD` for an epoch second that marks 00:00 UTC+8. */
export function readDayKey(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const shifted = new Date((timestamp + CST_OFFSET_SECONDS) * 1000)
  if (Number.isNaN(shifted.getTime())) return null
  return shifted.toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wereadWebErrCode(payload: Record<string, unknown>): number {
  if (typeof payload.errCode === 'number') return payload.errCode
  if (typeof payload.errcode === 'number') return payload.errcode
  return 0
}

/** The stored wr_skey only survives through sliding renewal: every upstream
 * response may rotate it via Set-Cookie, and a dropped rotation eventually
 * logs the stored session out even though the account is still live. */
function absorbCredentialRotation(
  headers: Headers,
  credential: WereadWebCredential,
  onCredentialRefresh: ((next: WereadWebCredential) => void) | undefined,
): void {
  if (!onCredentialRefresh) return
  const next = { ...credential }
  let changed = false
  for (const header of headers.getSetCookie()) {
    const pair = header.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (!name || !value) continue
    if (name === 'wr_vid' && value !== next.vid) { next.vid = value; changed = true }
    if (name === 'wr_skey' && value !== next.skey) { next.skey = value; changed = true }
  }
  if (changed) onCredentialRefresh(next)
}

async function readInfoRequest(credential: WereadWebCredential, bookId: string, onCredentialRefresh?: (next: WereadWebCredential) => void): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    bookId,
    // Without these three the endpoint answers with bookInfo only — the daily
    // breakdown is opt-in, and every omitted flag silently removes a section.
    readingDetail: '1',
    readingBookIndex: '1',
    finishedDate: '1',
  })

  let response: Response
  try {
    response = await fetch(`${READINFO_ENDPOINT}?${params.toString()}`, {
      headers: {
        Cookie: serializeWereadCookie(credential),
        Referer: 'https://weread.qq.com/',
        Origin: 'https://weread.qq.com',
        'User-Agent': WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `WeRead web API unavailable (${describeNetworkCause(err)})`)
  }
  if (response.status === 401) throw new AppError('WEREAD_WEB_AUTH_EXPIRED', 'WeRead login has expired. Sign in again to continue.')
  if (!response.ok) throw new AppError('VALIDATION_ERROR', `WeRead web API returned HTTP ${response.status}`)
  absorbCredentialRotation(response.headers, credential, onCredentialRefresh)

  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'WeRead web API returned a non-JSON response')
  }
  if (!isRecord(parsed)) throw new AppError('VALIDATION_ERROR', 'WeRead web API returned an unexpected payload')

  // Failures arrive as HTTP 200 with an errCode in the body: -2012 is an
  // expired wr_skey, -2010 a request with no usable session at all.
  const errCode = wereadWebErrCode(parsed)
  if (errCode === -2012 || errCode === -2010) {
    throw new AppError('WEREAD_WEB_AUTH_EXPIRED', 'WeRead login has expired. Sign in again to continue.')
  }
  if (errCode !== 0) {
    throw new AppError('VALIDATION_ERROR', `WeRead web API returned error ${errCode}`)
  }
  return parsed
}

/** Cookie-authenticated V1 endpoints used by the Web import channel. The
 * endpoint shapes are normalized by `weread-import.ts` through this adapter. */
export async function fetchWereadWebApi(
  credential: WereadWebCredential,
  params: Record<string, unknown>,
  onCredentialRefresh?: (next: WereadWebCredential) => void,
): Promise<Record<string, unknown>> {
  const apiName = String(params.api_name ?? '')
  const query = new URLSearchParams()
  let endpoint: string
  let method: 'GET' | 'POST' = 'GET'
  let body: string | undefined
  if (apiName === '/user/notebooks') {
    endpoint = 'https://weread.qq.com/api/user/notebook'
  } else if (apiName === '/book/bookmarklist') {
    endpoint = 'https://i.weread.qq.com/book/bookmarklist'
    query.set('bookId', String(params.bookId ?? ''))
    query.set('type', '1')
  } else if (apiName === '/review/list/mine') {
    endpoint = 'https://weread.qq.com/web/review/list'
    query.set('bookId', String(params.bookid ?? ''))
    query.set('listType', '11')
    query.set('mine', '1')
    query.set('syncKey', String(params.synckey ?? 0))
    query.set('count', String(params.count ?? 50))
  } else if (apiName === '/book/getprogress') {
    endpoint = 'https://weread.qq.com/web/book/getProgress'
    query.set('bookId', String(params.bookId ?? ''))
  } else if (apiName === '/shelf/sync') {
    endpoint = 'https://i.weread.qq.com/shelf/sync'
    method = 'POST'
    body = JSON.stringify({ userVid: credential.vid, synckey: 0 })
  } else {
    throw new AppError('VALIDATION_ERROR', 'Unsupported WeRead web import endpoint')
  }

  let response: Response
  try {
    response = await fetch(query.size > 0 ? `${endpoint}?${query}` : endpoint, {
      method,
      ...(body ? { body } : {}),
      headers: {
        Cookie: serializeWereadCookie(credential),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Referer: 'https://weread.qq.com/',
        Origin: 'https://weread.qq.com',
        'User-Agent': WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', `WeRead web API unavailable (${describeNetworkCause(err)})`)
  }
  if (response.status === 401) throw new AppError('WEREAD_WEB_AUTH_EXPIRED', 'WeRead login has expired. Sign in again to continue.')
  if (!response.ok) throw new AppError('VALIDATION_ERROR', `WeRead web API returned HTTP ${response.status}`)
  absorbCredentialRotation(response.headers, credential, onCredentialRefresh)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'WeRead web API returned a non-JSON response')
  }
  if (!isRecord(payload)) throw new AppError('VALIDATION_ERROR', 'WeRead web API returned an unexpected payload')
  const errCode = wereadWebErrCode(payload)
  if (errCode === -2012 || errCode === -2010) {
    throw new AppError('WEREAD_WEB_AUTH_EXPIRED', 'WeRead login has expired. Sign in again to continue.')
  }
  if (errCode !== 0) throw new AppError('VALIDATION_ERROR', `WeRead web API returned error ${errCode}`)
  return payload
}

export type WereadWebProbeResult = 'valid' | 'expired' | 'unknown'

/** A cheap authenticated GET that answers whether the stored session is still
 * accepted. Anything other than a definitive upstream auth rejection is
 * 'unknown' — network noise and unfamiliar error codes must never flip the
 * stored validity, and every probe response also renews the session the same
 * way a data request does. */
export async function probeWereadWebSession(
  credential: WereadWebCredential,
  onCredentialRefresh?: (next: WereadWebCredential) => void,
): Promise<WereadWebProbeResult> {
  let response: Response
  try {
    response = await fetch('https://weread.qq.com/api/user/notebook', {
      headers: {
        Cookie: serializeWereadCookie(credential),
        Referer: 'https://weread.qq.com/',
        Origin: 'https://weread.qq.com',
        'User-Agent': WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return 'unknown'
  }
  absorbCredentialRotation(response.headers, credential, onCredentialRefresh)
  if (response.status === 401) return 'expired'
  if (!response.ok) return 'unknown'
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return 'unknown'
  }
  if (!isRecord(payload)) return 'unknown'
  const errCode = wereadWebErrCode(payload)
  if (errCode === -2012 || errCode === -2010) return 'expired'
  if (errCode !== 0) return 'unknown'
  return 'valid'
}

/** One request per book: this is the only channel that knows how much was read
 * on a given day, and it has no batch form. */
export async function fetchBookReadInfo(
  credential: WereadWebCredential,
  bookId: string,
  onCredentialRefresh?: (next: WereadWebCredential) => void,
): Promise<WereadBookReadInfo> {
  const payload = await readInfoRequest(credential, bookId, onCredentialRefresh)
  const detail = isRecord(payload.readDetail) ? payload.readDetail : {}
  const rawDays = Array.isArray(detail.data) ? detail.data : []

  const days: WereadReadDay[] = []
  let droppedDays = 0
  for (const entry of rawDays) {
    if (!isRecord(entry)) continue
    const date = readDayKey(Number(entry.readDate))
    const seconds = Number(entry.readTime)
    if (!date || !Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_DAY_SECONDS) {
      droppedDays += 1
      continue
    }
    days.push({ date, seconds: Math.round(seconds) })
  }

  const totalSeconds = Number(payload.readingTime)
  const progress = Number(payload.readingProgress)
  const markedStatus = Number(payload.markedStatus)

  return {
    days,
    totalSeconds: Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0,
    progress: Number.isFinite(progress) && progress >= 0 ? progress : null,
    // A finished book is flagged, not timed: `finishedDate` is absent on every
    // other book even when it was requested.
    finished: markedStatus === 4,
    finishedDate: typeof payload.finishedDate === 'number' ? readDayKey(payload.finishedDate) : null,
    droppedDays,
  }
}
