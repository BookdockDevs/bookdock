import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { getLegadoAccessKeyInfo, getOrCreateLegadoAccessKey, issueLegadoAccessKey, resolveLegadoAccessKey, revokeLegadoAccessKey, rotateLegadoAccessKey } from './legado-access.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

describe('Legado access keys', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: `user-${userId}`, createdAt: Date.now() }).run()
  })

  it('issues the three supported durations and reports a public-safe status', () => {
    const issued = issueLegadoAccessKey(userId, '90d')
    expect(issued.token).toMatch(/^bd_src_[A-Za-z0-9_-]+$/)
    expect(issued.expiresAt).toBe(issued.createdAt + 90 * 24 * 60 * 60 * 1000)
    expect(getLegadoAccessKeyInfo(userId)).toEqual({ active: true, createdAt: issued.createdAt, expiresAt: issued.expiresAt })

    const permanent = issueLegadoAccessKey(userId, 'permanent')
    expect(permanent.expiresAt).toBeNull()
    expect(getLegadoAccessKeyInfo(userId).expiresAt).toBeNull()
  })

  it('rotates the stable source identity and invalidates the old secret', () => {
    const first = issueLegadoAccessKey(userId, '1y')
    const second = issueLegadoAccessKey(userId, '1y')

    expect(second.id).toBe(first.id)
    expect(resolveLegadoAccessKey(first.token)).toBeNull()
    expect(resolveLegadoAccessKey(second.token)).toMatchObject({ id: first.id, userId })
    expect(db.select().from(schema.legadoAccessKeys).where(eq(schema.legadoAccessKeys.userId, userId)).all()).toHaveLength(1)
  })

  it('rejects expired and revoked keys', () => {
    const issued = issueLegadoAccessKey(userId, '90d')
    db.update(schema.legadoAccessKeys)
      .set({ expiresAt: Date.now() - 1 })
      .where(and(eq(schema.legadoAccessKeys.userId, userId), eq(schema.legadoAccessKeys.id, issued.id)))
      .run()
    expect(resolveLegadoAccessKey(issued.token)).toBeNull()

    const replacement = issueLegadoAccessKey(userId, 'permanent')
    revokeLegadoAccessKey(userId)
    expect(resolveLegadoAccessKey(replacement.token)).toBeNull()
    expect(getLegadoAccessKeyInfo(userId).active).toBe(false)
  })

  it('automatically ensures or retrieves an existing access key', () => {
    const ensured = getOrCreateLegadoAccessKey(userId)
    expect(ensured.token).toMatch(/^bd_src_/)

    const existing = getOrCreateLegadoAccessKey(userId)
    expect(existing.token).toBe(ensured.token)
    expect(existing.id).toBe(ensured.id)

    const rotated = rotateLegadoAccessKey(userId)
    expect(rotated.token).not.toBe(ensured.token)
    expect(rotated.id).toBe(ensured.id)
    expect(resolveLegadoAccessKey(ensured.token)).toBeNull()
    expect(resolveLegadoAccessKey(rotated.token)).toMatchObject({ id: ensured.id, userId })
  })
})
