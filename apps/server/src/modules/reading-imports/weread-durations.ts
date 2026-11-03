import { and, eq } from 'drizzle-orm'

import type { WereadQrLoginFailure, WereadQrLoginStart, WereadQrLoginStatus, WereadWebSessionStatus } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { log } from '../../lib/logger'
import { decryptPassword, encryptPassword } from '../../lib/secrets'
import { AppError } from '../../middleware/error'
import { createWereadQrChallenge, finishWereadQrLogin, WereadQrLoginExchangeError } from './weread-web-login'
import { parseWereadCookie, probeWereadWebSession, serializeWereadCookie, type WereadWebCredential } from './weread-web'

const SETTINGS_KEY = 'weread-web-session'
/** A verification younger than this answers the UI probe without a network
 * round trip; the hourly keep-alive keeps real verifications flowing anyway. */
const SESSION_VERIFY_FRESH_MS = 30 * 60 * 1000
/** WeRead's web wr_skey lasts 90 minutes without activity; one hourly ping
 * keeps every stored session comfortably inside the sliding window. */
const KEEP_ALIVE_START_DELAY_MS = 30_000
const KEEP_ALIVE_INTERVAL_MS = 60 * 60 * 1000

interface StoredSession {
  cookie: string
  vid: string
  updatedAt: number
  /** Last upstream confirmation that the session is accepted; 0 = never. */
  verifiedAt: number
  /** Set after a definitive auth rejection. The cookie is kept so a later
   * rotation or re-login can recover; only the UI flips to "not logged in". */
  expired: boolean
}

interface PendingQrLogin {
  id: string
  userId: string
  uid: string
  confirmUrl: string
  cookies: Map<string, string>
  expiresAt: number
  status: WereadQrLoginStatus['status']
  failure: WereadQrLoginFailure | null
  controller: AbortController
}

const QR_LOGIN_TTL_MS = 120_000
const QR_LOGIN_RETENTION_MS = 120_000
const pendingQrLogins = new Map<string, PendingQrLogin>()

export async function startWereadQrLogin(userId: string): Promise<WereadQrLoginStart> {
  for (const session of pendingQrLogins.values()) {
    if (session.userId === userId && session.status === 'pending') {
      session.status = 'expired'
      session.controller.abort()
    }
  }

  const challenge = await createWereadQrChallenge()
  const id = createId('wrl')
  const expiresAt = Date.now() + QR_LOGIN_TTL_MS
  const session: PendingQrLogin = {
    id,
    userId,
    uid: challenge.uid,
    confirmUrl: challenge.confirmUrl,
    cookies: challenge.cookies,
    expiresAt,
    status: 'pending',
    failure: null,
    controller: new AbortController(),
  }
  pendingQrLogins.set(id, session)
  setTimeout(() => pendingQrLogins.delete(id), QR_LOGIN_TTL_MS + QR_LOGIN_RETENTION_MS).unref()

  void finishWereadQrLogin(session.uid, session.controller.signal, session.cookies).then((credential) => {
    if (session.status !== 'pending' || Date.now() >= session.expiresAt) return
    saveWereadWebSession(userId, serializeWereadCookie(credential))
    session.status = 'complete'
  }).catch((error: unknown) => {
    if (session.status !== 'pending' || Date.now() >= session.expiresAt) return
    session.status = 'failed'
    session.failure = error instanceof WereadQrLoginExchangeError
      ? error.failure
      : { stage: 'unknown', kind: 'unexpected' }
  })

  setTimeout(() => {
    if (session.status === 'pending') {
      session.status = 'expired'
      session.controller.abort()
    }
  }, QR_LOGIN_TTL_MS).unref()

  return { id, confirmUrl: session.confirmUrl, expiresAt }
}

export function getWereadQrLoginStatus(userId: string, id: string): WereadQrLoginStatus {
  const session = pendingQrLogins.get(id)
  if (!session || session.userId !== userId) {
    throw new AppError('VALIDATION_ERROR', 'WeRead QR login session not found')
  }
  if (session.status === 'pending' && Date.now() >= session.expiresAt) {
    session.status = 'expired'
    session.controller.abort()
  }
  return {
    status: session.status,
    session: session.status === 'complete' ? getWereadWebSessionStatus(userId) : null,
    failure: session.status === 'failed' ? session.failure : null,
  }
}

export function cancelWereadQrLogin(userId: string, id: string): void {
  const session = pendingQrLogins.get(id)
  if (!session || session.userId !== userId) return
  if (session.status === 'pending') {
    session.status = 'expired'
    session.controller.abort()
  }
}

function readStoredSession(userId: string): (Partial<StoredSession> & { cookie: string }) | null {
  const row = getDb().select().from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, SETTINGS_KEY),
  )).get()
  const stored = row?.value as Partial<StoredSession> | undefined
  return stored?.cookie ? stored as Partial<StoredSession> & { cookie: string } : null
}

export function getWereadWebSessionStatus(userId: string): WereadWebSessionStatus {
  const stored = readStoredSession(userId)
  if (!stored) return { configured: false, vid: null, updatedAt: null, valid: true }
  return {
    configured: true,
    vid: typeof stored.vid === 'string' ? stored.vid : null,
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : null,
    valid: stored.expired !== true,
  }
}

export function getWereadWebCredential(userId: string): WereadWebCredential | null {
  const stored = readStoredSession(userId)
  if (!stored) return null
  try {
    const raw = decryptPassword(stored.cookie)
    return raw ? parseWereadCookie(raw) : null
  } catch {
    // A stored value that no longer parses is as good as absent.
    return null
  }
}

export function saveWereadWebSession(userId: string, rawCookie: string): WereadWebSessionStatus {
  const credential = parseWereadCookie(rawCookie)
  const db = getDb()
  // A fresh login or paste is valid by definition, so it starts fully verified.
  const value: StoredSession = {
    // Only the two cookies the API needs are ever persisted, and always
    // encrypted: this credential can order books, unlike the read-only key.
    cookie: encryptPassword(serializeWereadCookie(credential)),
    vid: credential.vid,
    updatedAt: Date.now(),
    verifiedAt: Date.now(),
    expired: false,
  }
  const row = db.select({ id: settings.id }).from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, SETTINGS_KEY),
  )).get()
  if (row) db.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
  else db.insert(settings).values({ id: createId('setting'), userId, key: SETTINGS_KEY, value }).run()
  return { configured: true, vid: credential.vid, updatedAt: value.updatedAt, valid: true }
}

export function clearWereadWebSession(userId: string): void {
  getDb().delete(settings).where(and(eq(settings.userId, userId), eq(settings.key, SETTINGS_KEY))).run()
}

/** Persists a credential rotated by upstream Set-Cookie so the stored session
 * keeps sliding forward. A rotation is itself proof of validity. */
export function refreshWereadWebCredential(userId: string, credential: WereadWebCredential): void {
  const db = getDb()
  const row = db.select().from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, SETTINGS_KEY),
  )).get()
  if (!row) return
  const stored = row.value as Partial<StoredSession> | undefined
  const raw = decryptPassword(stored?.cookie)
  if (raw) {
    try {
      const current = parseWereadCookie(raw)
      if (current.vid === credential.vid && current.skey === credential.skey) return
    } catch {
      // An unparseable stored value is replaced by the fresh credential.
    }
  }
  const value: StoredSession = {
    cookie: encryptPassword(serializeWereadCookie(credential)),
    vid: credential.vid,
    updatedAt: typeof stored?.updatedAt === 'number' ? stored.updatedAt : Date.now(),
    verifiedAt: Date.now(),
    expired: false,
  }
  db.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
}

function markSessionVerification(userId: string, verified: boolean): void {
  const stored = readStoredSession(userId)
  if (!stored) return
  const value: StoredSession = {
    cookie: stored.cookie,
    vid: typeof stored.vid === 'string' ? stored.vid : '',
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : Date.now(),
    verifiedAt: verified ? Date.now() : typeof stored.verifiedAt === 'number' ? stored.verifiedAt : 0,
    expired: !verified,
  }
  getDb().update(settings).set({ value }).where(and(
    eq(settings.userId, userId),
    eq(settings.key, SETTINGS_KEY),
  )).run()
}

/** Probes WeRead with the stored cookie unless a recent verification already
 * answered the question. Definitive rejections flip the stored validity;
 * network noise and unfamiliar errors leave it untouched. */
export async function verifyWereadWebSession(userId: string, maxAgeMs = SESSION_VERIFY_FRESH_MS): Promise<WereadWebSessionStatus> {
  const status = getWereadWebSessionStatus(userId)
  if (!status.configured) return status
  const stored = readStoredSession(userId)!
  const verifiedAt = typeof stored.verifiedAt === 'number' ? stored.verifiedAt : 0
  if (stored.expired !== true && verifiedAt > 0 && Date.now() - verifiedAt < maxAgeMs) return status

  const credential = getWereadWebCredential(userId)
  if (!credential) return status
  const probe = await probeWereadWebSession(credential, (next) => refreshWereadWebCredential(userId, next))
  if (probe === 'unknown') return status
  markSessionVerification(userId, probe === 'valid')
  return getWereadWebSessionStatus(userId)
}

/** Slides every stored session forward: one cheap authenticated request per
 * user, well under the 90-minute wr_skey TTL, also absorbing any rotation.
 * Sessions already marked expired stay untouched — only a re-login revives them. */
export async function runWereadWebSessionKeepAlive(): Promise<void> {
  const rows = getDb().select({ userId: settings.userId }).from(settings).where(eq(settings.key, SETTINGS_KEY)).all()
  for (const { userId } of rows) {
    try {
      const stored = readStoredSession(userId)
      if (!stored || stored.expired === true) continue
      await verifyWereadWebSession(userId, 0)
    } catch (error) {
      log('warn', 'weread.web_session.keepalive_failed', { error, meta: { userId } })
    }
  }
}

/** Boot-delayed first ping plus an hourly slide. Fire-and-forget by design:
 * keep-alive problems must never affect startup or request handling. */
export function startWereadWebSessionKeepAlive(): void {
  setTimeout(() => void runWereadWebSessionKeepAlive(), KEEP_ALIVE_START_DELAY_MS).unref()
  setInterval(() => void runWereadWebSessionKeepAlive(), KEEP_ALIVE_INTERVAL_MS).unref()
}
