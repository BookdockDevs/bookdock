import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { hashPassword } from '../../lib/password'
import { changePassword } from '../auth/auth.service'
import { createAccessToken, deleteAccessToken, listAccessTokens, resolveAccessToken, setAccessTokenDisabled, updateAccessToken } from './tokens.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

describe('access token service', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: `user-${userId}`, createdAt: Date.now() }).run()
  })

  function issue(overrides: Partial<Parameters<typeof createAccessToken>[1]> = {}) {
    return createAccessToken(userId, { name: 'extension', permissions: ['book:list'], expiresIn: '90d', ...overrides })
  }

  it('issues a bd_ token and stores only its hash and last four characters', () => {
    const { token, plaintext } = issue()

    expect(plaintext).toMatch(/^bd_[A-Za-z0-9_-]{43}$/)
    expect(token.tokenLast4).toBe(plaintext.slice(-4))
    expect(token.createdAt).toBeGreaterThan(0)
    expect(token.expiresAt).toBe(token.createdAt + 90 * 24 * 60 * 60 * 1000)
    expect(token.disabled).toBe(false)

    const row = db.select().from(schema.accessTokens).get()!
    expect(row.tokenHash).toBe(crypto.createHash('sha256').update(plaintext).digest('hex'))
    expect(row.permissions).toEqual(['book:list'])
    expect(row.disabledAt).toBeNull()
    // The plaintext itself must never be persisted anywhere in the row.
    expect(Object.values(row)).not.toContain(plaintext)
  })

  it('stores a null expiry for permanent tokens', () => {
    const { token } = issue({ expiresIn: 'permanent' })
    expect(token.expiresAt).toBeNull()
  })

  it('resolves an active token and reports disabled and unknown tokens apart', () => {
    const { token, plaintext } = issue({ permissions: ['book:list', 'book:file'] })

    expect(resolveAccessToken(plaintext)).toEqual({
      status: 'active',
      token: { id: token.id, userId, permissions: ['book:list', 'book:file'] },
    })
    expect(resolveAccessToken('bd_notarealtoken')).toEqual({ status: 'invalid' })
    expect(resolveAccessToken('eyJhbGciOiJIUzI1NiJ9.payload.signature')).toEqual({ status: 'invalid' })

    setAccessTokenDisabled(userId, token.id, true)
    expect(resolveAccessToken(plaintext)).toEqual({ status: 'disabled' })
  })

  it('rejects an expired token as invalid', () => {
    const { token, plaintext } = issue()
    db.update(schema.accessTokens).set({ expiresAt: Date.now() - 1 }).where(eq(schema.accessTokens.id, token.id)).run()
    expect(resolveAccessToken(plaintext)).toEqual({ status: 'invalid' })
  })

  it('restarts the expiry from the moment of the edit, not from creation', () => {
    const { token } = issue({ expiresIn: '90d' })
    const before = Date.now()
    const updated = updateAccessToken(userId, token.id, { expiresIn: '1y' })

    expect(updated.createdAt).toBe(token.createdAt)
    expect(updated.expiresAt).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 * 1000)
    expect(updated.expiresAt).not.toBe(token.expiresAt)

    expect(updateAccessToken(userId, token.id, { expiresIn: 'permanent' }).expiresAt).toBeNull()
  })

  it('applies name and permission edits immediately', () => {
    const { token, plaintext } = issue({ permissions: [] })
    expect(resolveAccessToken(plaintext)).toMatchObject({ token: { permissions: [] } })

    const updated = updateAccessToken(userId, token.id, { name: 'renamed', permissions: ['book:read'] })
    expect(updated.name).toBe('renamed')
    expect(resolveAccessToken(plaintext)).toMatchObject({ token: { permissions: ['book:read'] } })
  })

  it('stops and restores a token without touching its secret', () => {
    const { token, plaintext } = issue()

    setAccessTokenDisabled(userId, token.id, true)
    expect(resolveAccessToken(plaintext)).toEqual({ status: 'disabled' })

    setAccessTokenDisabled(userId, token.id, false)
    expect(resolveAccessToken(plaintext)).toMatchObject({ status: 'active' })
  })

  it('removes the row outright on delete, so the token stops resolving', () => {
    const { token, plaintext } = issue()

    deleteAccessToken(userId, token.id)
    expect(resolveAccessToken(plaintext)).toEqual({ status: 'invalid' })
    expect(db.select().from(schema.accessTokens).all()).toHaveLength(0)
    expect(() => deleteAccessToken(userId, token.id)).toThrowError(expect.objectContaining({ code: 'TOKEN_NOT_FOUND' }))
  })

  it('lists only the owning user\'s tokens, newest first', () => {
    const first = issue({ name: 'first' })
    db.update(schema.accessTokens).set({ createdAt: 1 }).where(eq(schema.accessTokens.id, first.token.id)).run()
    issue({ name: 'second' })

    const otherUserId = createId('user')
    db.insert(schema.users).values({ id: otherUserId, username: `user-${otherUserId}`, createdAt: Date.now() }).run()
    createAccessToken(otherUserId, { name: 'other', permissions: [], expiresIn: 'permanent' })

    expect(listAccessTokens(userId).map((token) => token.name)).toEqual(['second', 'first'])
  })

  it('keeps one user out of another user\'s tokens', () => {
    const { token } = issue()
    const otherUserId = createId('user')
    db.insert(schema.users).values({ id: otherUserId, username: `user-${otherUserId}`, createdAt: Date.now() }).run()

    expect(() => updateAccessToken(otherUserId, token.id, { name: 'hijacked' })).toThrowError(expect.objectContaining({ code: 'TOKEN_NOT_FOUND' }))
    expect(() => setAccessTokenDisabled(otherUserId, token.id, true)).toThrowError(expect.objectContaining({ code: 'TOKEN_NOT_FOUND' }))
    expect(() => deleteAccessToken(otherUserId, token.id)).toThrowError(expect.objectContaining({ code: 'TOKEN_NOT_FOUND' }))
    expect(db.select().from(schema.accessTokens).get()!.name).toBe('extension')
  })

  it('keeps tokens working after the owner changes their password', async () => {
    db.update(schema.users).set({ passwordHash: await hashPassword('oldpass6') }).where(eq(schema.users.id, userId)).run()
    const { plaintext } = issue()

    await changePassword(userId, 'oldpass6', 'newpass6')

    expect(resolveAccessToken(plaintext)).toMatchObject({ status: 'active' })
    expect(db.select().from(schema.accessTokens).all()).toHaveLength(1)
  })
})
