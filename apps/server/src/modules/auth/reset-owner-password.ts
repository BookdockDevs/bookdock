import { eq } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { users } from '../../db/schema'
import { hashPassword } from '../../lib/password'
import { revokeUserSessions } from './auth.service'

/**
 * Instance-owner recovery (3.12): server-side password reset when the owner
 * is locked out. No email, no tokens, no security questions by design.
 *
 * Usage (from apps/server, server stopped):
 *   DATA_DIR=/data npx tsx src/modules/auth/reset-owner-password.ts <username> <new-password>
 *
 * Sets the scrypt hash and revokes every session of the account, including
 * any attacker-held ones. The username must belong to an existing enabled
 * user; use the instance transfer flow for ownership changes.
 */
const [username, newPassword] = process.argv.slice(2)
if (!username || !newPassword || newPassword.length < 8 || newPassword.length > 128) {
  console.error('Usage: reset-owner-password.ts <username> <new-password (8-128 chars)>')
  process.exit(2)
}

const db = getDb()
const user = db.select().from(users).where(eq(users.username, username)).get()
if (!user) {
  console.error(`Unknown user: ${username}`)
  process.exit(1)
}
if (user.disabled === 1) {
  console.error(`Refusing to reset a disabled account: ${username}`)
  process.exit(1)
}
db.update(users)
  .set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() })
  .where(eq(users.id, user.id))
  .run()
revokeUserSessions(user.id)
console.log(`Password reset for ${username}; all sessions revoked, re-login required.`)
