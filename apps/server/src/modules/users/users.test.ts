import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import { resetAuthCaches } from '../../middleware/auth.guard'
import { hashPassword, verifyPassword } from '../../lib/password'
import usersRoutes from './users.routes'
import { listUsers, updateUser } from './users.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

async function insertUser(
  db: TestDb,
  opts: { username: string; role?: 'owner' | 'member' | 'guest'; password?: string },
) {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username: opts.username,
    passwordHash: opts.password ? await hashPassword(opts.password) : null,
    role: opts.role ?? 'member',
    createdAt: Date.now(),
  }).run()
  return id
}

function insertBook(db: TestDb, userId: string, deletedAt: number | null = null) {
  db.insert(schema.books).values({
    id: createId('book'),
    userId,
    title: 'Book',
    author: 'Author',
    format: 'txt',
    filePath: 'books/x/x.txt',
    coverKey: null,
    size: 100,
    meta: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt,
  }).run()
}

function createUsersApp(user: { id: string; username: string; role: string }) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/users/*', async (c, next) => {
    c.set('user', user)
    return next()
  })
  app.route('/api/v1/users', usersRoutes)
  return app
}

describe('users module', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    resetAuthCaches()
  })

  it('lists users with book counts (excluding trashed books)', async () => {
    await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    insertBook(db, memberId)
    insertBook(db, memberId)
    insertBook(db, memberId, Date.now())

    const list = listUsers()
    expect(list).toHaveLength(2)
    const member = list.find((u) => u.id === memberId)!
    expect(member.bookCount).toBe(2)
    expect(member.role).toBe('member')
    expect(member.disabled).toBe(false)
  })

  it('changes a user role', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    const updated = await updateUser(ownerId, memberId, { role: 'owner' })
    expect(updated.role).toBe('owner')
  })

  it('disables and re-enables a user', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    const disabled = await updateUser(ownerId, memberId, { disabled: true })
    expect(disabled.disabled).toBe(true)
    const enabled = await updateUser(ownerId, memberId, { disabled: false })
    expect(enabled.disabled).toBe(false)
  })

  it('resets a user password', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem', password: 'oldpass6' })
    await updateUser(ownerId, memberId, { newPassword: 'newpass6' })
    const row = db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()
    expect(await verifyPassword('newpass6', row!.passwordHash!)).toBe(true)
  })

  it('rejects setting a password on the guest account', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const guestId = await insertUser(db, { username: 'guest', role: 'guest' })
    await expect(updateUser(ownerId, guestId, { newPassword: 'hack123' }))
      .rejects.toMatchObject({ code: 'CANNOT_MODIFY_GUEST' })
    // non-password updates on the guest still work
    const disabled = await updateUser(ownerId, guestId, { disabled: true })
    expect(disabled.disabled).toBe(true)
  })

  it('rejects disabling or demoting oneself', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    await insertUser(db, { username: 'other', role: 'owner' })
    await expect(updateUser(ownerId, ownerId, { disabled: true })).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' })
    await expect(updateUser(ownerId, ownerId, { role: 'member' })).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' })
  })

  it('allows demoting an owner when another active owner remains', async () => {
    const actorId = await insertUser(db, { username: 'actor', role: 'owner' })
    const targetId = await insertUser(db, { username: 'target', role: 'owner' })
    const demoted = await updateUser(actorId, targetId, { role: 'member' })
    expect(demoted.role).toBe('member')
  })

  it('rejects disabling or demoting the last active owner', async () => {
    const actorId = await insertUser(db, { username: 'actor', role: 'owner' })
    const targetId = await insertUser(db, { username: 'target', role: 'owner' })
    // stale session: actor is itself disabled, so target is the only active owner
    db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, actorId)).run()
    await expect(updateUser(actorId, targetId, { disabled: true })).rejects.toMatchObject({ code: 'LAST_OWNER' })
    await expect(updateUser(actorId, targetId, { role: 'member' })).rejects.toMatchObject({ code: 'LAST_OWNER' })
  })

  it('rejects updates for a missing user', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    await expect(updateUser(ownerId, 'missing', { role: 'member' })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
  })

  describe('routes', () => {
    it('rejects members with 403', async () => {
      const app = createUsersApp({ id: 'u1', username: 'mem', role: 'member' })
      const res = await app.request('/api/v1/users')
      expect(res.status).toBe(403)
    })

    it('lists users for an owner', async () => {
      await insertUser(db, { username: 'own', role: 'owner' })
      const app = createUsersApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/users')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].username).toBe('own')
    })
  })
})
