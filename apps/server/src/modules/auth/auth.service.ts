import { randomInt } from 'node:crypto'

import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import {
  INSTANCE_INVITE_CODE_ALPHABET,
  INSTANCE_INVITE_RANDOM_LENGTH,
  isValidInstanceInviteCode,
  normalizeInstanceInviteCode,
  normalizeUsername,
} from '@bookdock/shared'

import type {
  AccountRes,
  CreateInstanceInviteReq,
  InstanceInfoRes,
  InstanceInviteLibraryRef,
  InstanceInviteRes,
  InstanceInviteStatus,
  RegistrationMode,
  UpdateInstanceReq,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { instance, instanceInviteLibraries, instanceInvites, libraries, sessions, users } from '../../db/schema'
import { config } from '../../config'
import { AppError, isUniqueViolation } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'
import { generateSessionToken, hashSessionToken } from '../../lib/token'
import { assertBindableSharedLibrary, attachMemberToSharedLibraryInTx, ensurePrivateLibrary } from '../libraries/library-access'

/** Single-row id of the deployment record; also used by the Phase 2 seed. */
export const INSTANCE_ID = 'instance'

/** Server-side login sessions: 30-day sliding expiry, refreshed inside 7 days of expiry. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000
/** Cookie lifetime mirrors the session lifetime. */
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const INSTANCE_CACHE_TTL = 5_000

export interface InstanceSettings {
  registrationMode: RegistrationMode
  allowRegistration: boolean
  allowGuestAccess: boolean
  /** Owner-set upload cap override; undefined = follow the UPLOAD_MAX_BYTES env default */
  uploadMaxBytes?: number
  /** Ordinary members may open new shared libraries; the instance owner always bypasses */
  allowUserCreateLibrary: boolean
  /** Ordinary members may upload files to their private library; the instance owner always bypasses */
  allowUserUpload: boolean
  /** Ordinary members may upload reading resources (fonts, dictionary imports); the instance owner always bypasses */
  allowUserResourceUpload: boolean
}

function resolveRegistrationMode(row?: { registrationMode?: string | null; allowRegistration?: boolean } | null): RegistrationMode {
  if (row?.registrationMode === 'closed' || row?.registrationMode === 'invite' || row?.registrationMode === 'open') {
    return row.registrationMode
  }
  return row?.allowRegistration === true ? 'open' : 'closed'
}

export interface SessionIdentity {
  userId: string
  sessionId: string
  expiresAt: number
}

let instanceCache: { value: InstanceSettings; at: number } | null = null

function isUsernameUniqueConstraint(err: unknown) {
  return err instanceof Error
    && 'code' in err
    && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
    && (err.message.includes('users.username') || err.message.includes('users.username_normalized'))
}

// Uniqueness is enforced on the normalized form (case-insensitive, NFKC),
// not raw bytes, so `Admin`/`admin`/`Ａdmin` cannot coexist as spoofing
// handles. New rows persist usernameNormalized (backfilled for old rows in
// Phase 2); the scan below stays as the pre-insert check and the UNIQUE
// constraints as the race backstop.
function findUsernameCollision(db: Pick<ReturnType<typeof getDb>, 'select'>, username: string, exceptId?: string) {
  const norm = normalizeUsername(username)
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .all()
    .find((r) => r.id !== exceptId && normalizeUsername(r.username) === norm)
}

export function resetInstanceCache() {
  instanceCache = null
}

/** Instance ownership has exactly one source of truth. */
export function isInstanceOwner(userId: string): boolean {
  const db = getDb()
  const row = db.select({ ownerUserId: instance.ownerUserId }).from(instance).get()

  return row?.ownerUserId === userId
}

/**
 * Operator-run city gates: ordinary members lose the action while the switch
 * is off; the instance owner always bypasses. Shared-library managers keep
 * their curation path — catalog uploads already require a manager seat, so
 * only private uploads, TXT appends and library creation check here.
 */
export function assertUserUploadAllowed(userId: string): void {
  if (!getInstanceSettings().allowUserUpload && !isInstanceOwner(userId)) {
    throw new AppError('FORBIDDEN', 'Uploads are disabled by the instance owner')
  }
}

export function assertUserCreateLibraryAllowed(userId: string): void {
  if (!getInstanceSettings().allowUserCreateLibrary && !isInstanceOwner(userId)) {
    throw new AppError('FORBIDDEN', 'Library creation is disabled by the instance owner')
  }
}

/**
 * Reading-resource upload gate: covers only member writes that put resource
 * files on the server (font uploads, dictionary imports). Managing already
 * uploaded resources and system/builtin fonts stays available; the instance
 * owner always bypasses.
 */
export function assertResourceUploadAllowed(userId: string): void {
  if (!getInstanceSettings().allowUserResourceUpload && !isInstanceOwner(userId)) {
    throw new AppError('FORBIDDEN', 'Reading resource uploads are disabled by the instance owner')
  }
}

export function getInstanceSettings(): InstanceSettings {
  if (instanceCache && Date.now() - instanceCache.at < INSTANCE_CACHE_TTL) {
    return instanceCache.value
  }
  const db = getDb()
  const row = db.select().from(instance).where(eq(instance.id, INSTANCE_ID)).get()
  const registrationMode = resolveRegistrationMode(row)
  const value: InstanceSettings = {
    registrationMode,
    allowRegistration: registrationMode === 'open',
    allowGuestAccess: row?.allowGuestAccess === true,
    uploadMaxBytes: typeof row?.uploadMaxBytes === 'number' && row.uploadMaxBytes > 0 ? row.uploadMaxBytes : undefined,
    // Absent on pre-0029 rows (and in tests seeding the row by hand): an
    // unset switch reads as open, so existing instances keep their behavior.
    allowUserCreateLibrary: row?.allowUserCreateLibrary !== false,
    allowUserUpload: row?.allowUserUpload !== false,
    allowUserResourceUpload: row?.allowUserResourceUpload !== false,
  }
  instanceCache = { value, at: Date.now() }
  return value
}

export function effectiveUploadMaxBytes(): number {
  return getInstanceSettings().uploadMaxBytes ?? config.uploadMaxBytes
}

export function getInstanceInfo(): InstanceInfoRes {
  const db = getDb()
  const initialized = Boolean(db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get())
  return { ...getInstanceSettings(), initialized, uploadMaxBytes: effectiveUploadMaxBytes() }
}

export function updateInstanceSettings(patch: UpdateInstanceReq): InstanceInfoRes {
  const db = getDb()
  const row = db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()
  if (!row) throw new AppError('FORBIDDEN', 'Instance is not initialized')
  const updates: Partial<typeof instance.$inferInsert> = { updatedAt: Date.now() }
  const nextRegistrationMode = patch.registrationMode !== undefined
    ? patch.registrationMode
    : patch.allowRegistration !== undefined
      ? (patch.allowRegistration ? 'open' : 'closed')
      : undefined
  if (nextRegistrationMode !== undefined) {
    updates.registrationMode = nextRegistrationMode
    updates.allowRegistration = nextRegistrationMode === 'open'
  }
  if (patch.allowGuestAccess !== undefined) updates.allowGuestAccess = patch.allowGuestAccess
  if (patch.uploadMaxBytes !== undefined) updates.uploadMaxBytes = patch.uploadMaxBytes
  if (patch.allowUserCreateLibrary !== undefined) updates.allowUserCreateLibrary = patch.allowUserCreateLibrary
  if (patch.allowUserUpload !== undefined) updates.allowUserUpload = patch.allowUserUpload
  if (patch.allowUserResourceUpload !== undefined) updates.allowUserResourceUpload = patch.allowUserResourceUpload
  db.update(instance).set(updates).where(eq(instance.id, INSTANCE_ID)).run()
  resetInstanceCache()
  return getInstanceInfo()
}

export function isSetupRequired(): boolean {
  const db = getDb()
  return !db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()
}

export function createSession(userId: string): { token: string; sessionId: string; expiresAt: number } {
  const db = getDb()
  const now = Date.now()
  db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now))).run()
  const token = generateSessionToken()
  const row = {
    id: createId('session'),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }
  db.insert(sessions).values(row).run()
  return { token, sessionId: row.id, expiresAt: row.expiresAt }
}

const sessionCache = new Map<string, { identity: SessionIdentity; at: number }>()
const SESSION_CACHE_TTL = 30_000

export function invalidateSessionCache(token?: string) {
  if (token) {
    sessionCache.delete(hashSessionToken(token))
  } else {
    sessionCache.clear()
  }
}

export function resolveSession(token: string): SessionIdentity | null {
  const tokenHash = hashSessionToken(token)
  const now = Date.now()
  const hit = sessionCache.get(tokenHash)
  if (hit && now - hit.at < SESSION_CACHE_TTL) {
    if (hit.identity.expiresAt > now) {
      return hit.identity
    }
    sessionCache.delete(tokenHash)
  }

  const db = getDb()
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get()
  if (!row) {
    sessionCache.delete(tokenHash)
    return null
  }
  if (row.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run()
    sessionCache.delete(tokenHash)
    return null
  }
  const identity: SessionIdentity = { userId: row.userId, sessionId: row.id, expiresAt: row.expiresAt }
  sessionCache.set(tokenHash, { identity, at: now })
  return identity
}

/** Extend sessions inside the refresh window; true means the cookie must be re-issued. */
export function refreshSessionIfNeeded(sessionId: string, expiresAt: number): boolean {
  if (expiresAt - Date.now() > SESSION_REFRESH_WITHIN_MS) return false
  getDb().update(sessions).set({ expiresAt: Date.now() + SESSION_TTL_MS }).where(eq(sessions.id, sessionId)).run()
  sessionCache.clear()
  return true
}

export function revokeSession(token: string): void {
  sessionCache.delete(hashSessionToken(token))
  getDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run()
}

export function revokeUserSessions(userId: string): void {
  sessionCache.clear()
  getDb().delete(sessions).where(eq(sessions.userId, userId)).run()
  invalidateUserCache(userId)
}

function getPrivateLibraryId(userId: string): string {
  const db = getDb()
  const row = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  return row?.id ?? ensurePrivateLibrary(db, userId)
}

function toAuthPayload(user: { id: string; username: string; avatarKey: string | null }) {
  return {
    id: user.id,
    username: user.username,
    role: isInstanceOwner(user.id) ? 'owner' : 'member',
    avatarKey: user.avatarKey,
    privateLibraryId: getPrivateLibraryId(user.id),
  }
}

function createPrivateLibrary(tx: Pick<ReturnType<typeof getDb>, 'insert'>, userId: string) {
  const now = Date.now()
  tx.insert(libraries).values({
    id: createId('lib'), userId, type: 'private', name: '',
    description: '', visibility: null, createdAt: now, updatedAt: now,
  }).run()
}

export async function login(username: string, password: string) {
  const db = getDb()
  // Identity is the normalized username (case/NFKC-insensitive), matching
  // registration uniqueness: `Admin` must log in as `admin` too.
  const norm = normalizeUsername(username)
  const user = db.select().from(users).all().find((row) => normalizeUsername(row.username) === norm)
  if (!user || !user.passwordHash) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  if (user.disabled === 1) {
    throw new AppError('ACCOUNT_DISABLED', 'Account is disabled')
  }
  const { token } = createSession(user.id)
  return { token, user: toAuthPayload(user) }
}

function resolveInviteStatus(
  row: { expiresAt: number | null; maxUses: number | null; usedCount: number },
  now: number,
): InstanceInviteStatus {
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired'
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return 'exhausted'
  return 'active'
}

function toInstanceInviteRes(
  row: typeof instanceInvites.$inferSelect,
  autoJoinLibraries: InstanceInviteLibraryRef[],
  now: number,
): InstanceInviteRes {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    autoJoinLibraries,
    maxUses: row.maxUses ?? null,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    status: resolveInviteStatus(row, now),
  }
}

function loadInviteLibrariesMap(
  db: Pick<ReturnType<typeof getDb>, 'select'>,
  inviteIds: string[],
): Map<string, InstanceInviteLibraryRef[]> {
  const map = new Map<string, InstanceInviteLibraryRef[]>()
  if (inviteIds.length === 0) return map
  const rows = db
    .select({
      inviteId: instanceInviteLibraries.inviteId,
      libraryId: libraries.id,
      libraryName: libraries.name,
      libraryType: libraries.type,
    })
    .from(instanceInviteLibraries)
    .innerJoin(libraries, eq(instanceInviteLibraries.libraryId, libraries.id))
    .where(inArray(instanceInviteLibraries.inviteId, inviteIds))
    .all()
  for (const row of rows) {
    if (row.libraryType !== 'shared') continue
    const list = map.get(row.inviteId) ?? []
    list.push({ id: row.libraryId, name: row.libraryName })
    map.set(row.inviteId, list)
  }
  return map
}

function generateInstanceInviteCode(): string {
  let code = ''
  for (let i = 0; i < INSTANCE_INVITE_RANDOM_LENGTH; i += 1) {
    code += INSTANCE_INVITE_CODE_ALPHABET[randomInt(INSTANCE_INVITE_CODE_ALPHABET.length)]
  }
  return code
}

export function listInstanceInvites(actorId: string): InstanceInviteRes[] {
  if (!isInstanceOwner(actorId)) throw new AppError('FORBIDDEN', 'Owner only')
  const db = getDb()
  const now = Date.now()
  const rows = db
    .select()
    .from(instanceInvites)
    .where(isNull(instanceInvites.revokedAt))
    .orderBy(desc(instanceInvites.createdAt))
    .all()
  const librariesByInvite = loadInviteLibrariesMap(db, rows.map((r) => r.id))
  return rows.map((row) => toInstanceInviteRes(row, librariesByInvite.get(row.id) ?? [], now))
}

export function createInstanceInvite(actorId: string, req: CreateInstanceInviteReq): InstanceInviteRes {
  if (!isInstanceOwner(actorId)) throw new AppError('FORBIDDEN', 'Owner only')
  const db = getDb()
  const now = Date.now()
  if (req.expiresAt != null && req.expiresAt <= now) {
    throw new AppError('VALIDATION_ERROR', 'Expiration time must be in the future')
  }
  const uniqueLibraryIds = [...new Set(req.autoJoinLibraryIds ?? [])]
  const boundLibraries = uniqueLibraryIds.map((libraryId) => assertBindableSharedLibrary(actorId, libraryId))
  const label = req.label?.trim() ?? ''
  const maxUses = req.maxUses ?? null
  const expiresAt = req.expiresAt ?? null

  const insertWithCode = (code: string): InstanceInviteRes => {
    const id = createId('inv')
    const created = db.transaction((tx) => {
      tx.insert(instanceInvites).values({
        id,
        code,
        label,
        createdByUserId: actorId,
        maxUses,
        usedCount: 0,
        expiresAt,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      if (boundLibraries.length > 0) {
        tx.insert(instanceInviteLibraries).values(
          boundLibraries.map((lib) => ({ inviteId: id, libraryId: lib.id })),
        ).run()
      }
      const row = tx.select().from(instanceInvites).where(eq(instanceInvites.id, id)).get()
      if (!row) throw new AppError('INTERNAL_ERROR', 'Failed to create invite')
      return row
    })
    return toInstanceInviteRes(created, boundLibraries, now)
  }

  if (req.code) {
    try {
      return insertWithCode(normalizeInstanceInviteCode(req.code))
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('INVITE_CODE_TAKEN', 'Invite code already exists')
      }
      throw err
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return insertWithCode(generateInstanceInviteCode())
    } catch (err) {
      if (isUniqueViolation(err)) continue
      throw err
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Failed to allocate unique invite code')
}

export function deleteInstanceInvite(actorId: string, inviteId: string): { id: string } {
  if (!isInstanceOwner(actorId)) throw new AppError('FORBIDDEN', 'Owner only')
  const db = getDb()
  const existing = db.select({ id: instanceInvites.id }).from(instanceInvites).where(eq(instanceInvites.id, inviteId)).get()
  if (!existing) throw new AppError('INVITE_NOT_FOUND', 'Invite not found')
  db.delete(instanceInvites).where(eq(instanceInvites.id, inviteId)).run()
  return { id: existing.id }
}

export async function register(username: string, password: string, rawInviteCode?: string) {
  const preSettings = getInstanceSettings()
  if (preSettings.registrationMode === 'closed') {
    throw new AppError('REGISTRATION_DISABLED', 'Registration is disabled')
  }
  const inviteCode = rawInviteCode ? normalizeInstanceInviteCode(rawInviteCode) : undefined
  if (preSettings.registrationMode === 'invite' && !inviteCode) {
    throw new AppError('INVITE_CODE_REQUIRED', 'Invite code is required')
  }
  if (inviteCode && !isValidInstanceInviteCode(inviteCode)) {
    throw new AppError('INVITE_CODE_INVALID', 'Invalid or expired invite code')
  }
  const db = getDb()
  if (inviteCode) {
    const preNow = Date.now()
    const activeInvite = db
      .select({ id: instanceInvites.id })
      .from(instanceInvites)
      .where(and(
        eq(instanceInvites.code, inviteCode),
        isNull(instanceInvites.revokedAt),
        or(isNull(instanceInvites.expiresAt), gt(instanceInvites.expiresAt, preNow)),
        or(isNull(instanceInvites.maxUses), lt(instanceInvites.usedCount, instanceInvites.maxUses)),
      ))
      .get()
    if (!activeInvite) {
      throw new AppError('INVITE_CODE_INVALID', 'Invalid or expired invite code')
    }
  }
  if (findUsernameCollision(db, username)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  const id = createId('user')
  const hash = await hashPassword(password)
  const joinedLibraries = db.transaction((tx) => {
    const now = Date.now()
    const instRow = tx.select({
      registrationMode: instance.registrationMode,
      allowRegistration: instance.allowRegistration,
    }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()
    const txMode = resolveRegistrationMode(instRow)
    if (txMode === 'closed') {
      throw new AppError('REGISTRATION_DISABLED', 'Registration is disabled')
    }
    if (txMode === 'invite' && !inviteCode) {
      throw new AppError('INVITE_CODE_REQUIRED', 'Invite code is required')
    }

    let consumedInviteId: string | null = null
    if (inviteCode) {
      const consumed = tx.update(instanceInvites)
        .set({
          usedCount: sql`${instanceInvites.usedCount} + 1`,
          updatedAt: now,
        })
        .where(and(
          eq(instanceInvites.code, inviteCode),
          isNull(instanceInvites.revokedAt),
          or(isNull(instanceInvites.expiresAt), gt(instanceInvites.expiresAt, now)),
          or(isNull(instanceInvites.maxUses), lt(instanceInvites.usedCount, instanceInvites.maxUses)),
        ))
        .returning({ id: instanceInvites.id })
        .get()
      if (!consumed) {
        throw new AppError('INVITE_CODE_INVALID', 'Invalid or expired invite code')
      }
      consumedInviteId = consumed.id
    }

    if (findUsernameCollision(tx, username)) {
      throw new AppError('USERNAME_TAKEN', 'Username is already taken')
    }
    try {
      tx.insert(users).values({
        id,
        username,
        usernameNormalized: normalizeUsername(username),
        passwordHash: hash,
        createdAt: now,
        updatedAt: now,
      }).run()
    } catch (err) {
      if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      throw err
    }
    createPrivateLibrary(tx, id)
    if (!consumedInviteId) return []
    const targetLibraries = tx
      .select({ libraryId: instanceInviteLibraries.libraryId })
      .from(instanceInviteLibraries)
      .where(eq(instanceInviteLibraries.inviteId, consumedInviteId))
      .all()
    const joined: InstanceInviteLibraryRef[] = []
    for (const target of targetLibraries) {
      const attached = attachMemberToSharedLibraryInTx(tx, id, target.libraryId, now)
      if (attached) joined.push(attached)
    }
    return joined
  })
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  const { token } = createSession(user.id)
  return {
    token,
    user: toAuthPayload(user),
    ...(joinedLibraries.length > 0 ? { joinedLibraries } : {}),
  }
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string) {
  const db = getDb()
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user || !user.passwordHash) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  const valid = await verifyPassword(oldPassword, user.passwordHash)
  if (!valid) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .run()
  revokeUserSessions(userId)
}

export function changeUsername(userId: string, username: string): AccountRes {
  const db = getDb()
  if (findUsernameCollision(db, username, userId)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  try {
    db.update(users)
      .set({ username, usernameNormalized: normalizeUsername(username), updatedAt: Date.now() })
      .where(eq(users.id, userId)).run()
  } catch (err) {
    if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
    throw err
  }
  // The guard caches username/avatarKey for /me; drop the stale entry
  invalidateUserCache(userId)
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new AppError('USER_NOT_FOUND')
  return {
    id: row.id,
    username: row.username,
    role: isInstanceOwner(row.id) ? 'owner' : 'member',
    avatarKey: row.avatarKey,
    privateLibraryId: getPrivateLibraryId(row.id),
  }
}

export function updateBio(userId: string, bio: string) {
  const db = getDb()
  db.update(users).set({ bio, updatedAt: Date.now() }).where(eq(users.id, userId)).run()
  return { bio }
}

/**
 * Store the reader's IANA zone so server-rendered dates can mean something to
 * them. The Web app reports it because the browser already knows it; the field
 * is deliberately not part of AccountRes, since nothing in the Web UI reads it
 * back — the Web formats in the browser instead.
 */
export function updateTimezone(userId: string, timezone: string | null): void {
  getDb().update(users)
    .set({ timezone, updatedAt: Date.now() })
    .where(eq(users.id, userId)).run()
}

export function getUserTimezone(userId: string): string | null {
  return getDb().select({ timezone: users.timezone }).from(users)
    .where(eq(users.id, userId)).get()?.timezone ?? null
}

export async function setupUser(username: string, password: string) {
  const db = getDb()
  if (!isSetupRequired()) {
    throw new AppError('FORBIDDEN', 'Setup already completed')
  }
  if (findUsernameCollision(db, username)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  const hash = await hashPassword(password)
  const user = db.transaction((tx) => {
    // Recheck inside the transaction: setup state is the instance row now,
    // so concurrent setups create at most one owner, library and instance.
    if (tx.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()) {
      throw new AppError('FORBIDDEN', 'Setup already completed')
    }
    const id = createId('user')
    const now = Date.now()
    try {
      tx.insert(users).values({
        id, username, usernameNormalized: normalizeUsername(username),
        passwordHash: hash, createdAt: now, updatedAt: now,
      }).run()
    } catch (err) {
      if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      throw err
    }
    createPrivateLibrary(tx, id)
    tx.insert(instance).values({
      id: INSTANCE_ID, ownerUserId: id,
      registrationMode: 'closed', allowRegistration: false, allowGuestAccess: false, uploadMaxBytes: null,
      createdAt: now, updatedAt: now,
    }).run()
    const created = tx.select().from(users).where(eq(users.id, id)).get()
    if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
    return created
  })
  const { token } = createSession(user.id)
  return { token, user: toAuthPayload(user) }
}
