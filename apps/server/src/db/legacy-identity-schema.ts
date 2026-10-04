// Frozen identity schema for pre-0040 upgrade bridges and historical fixtures only.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  // Trimmed/NFKC/case-folded identity; NULL during the compat window
  // (the UNIQUE index in 0008 ignores NULLs, so backfill in Phase 2 cannot collide).
  usernameNormalized: text('username_normalized').unique(),
  bio: text('bio').notNull().default(''),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member', 'guest'] }).notNull().default('owner'),
  disabled: integer('disabled').notNull().default(0),
  avatarKey: text('avatar_key'),
  // IANA zone reported by the client, used only to render timestamps the server
  // formats (the Legado book source). NULL means UTC, which is what a server
  // rendering for an unidentified reader has to assume anyway.
  timezone: text('timezone'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
})

export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

