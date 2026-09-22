import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'

import { BOOKDOCK_BUILD_INFO, type InternalVersionRes } from '@bookdock/shared'

import { config } from '../../config'

const internalRoutes = new Hono()

function nonceMatches(provided: string | undefined): boolean {
  const expected = config.launcherNonce
  if (!expected || !provided) return false
  const [left, right] = [Buffer.from(expected), Buffer.from(provided)]
  // timingSafeEqual throws on length mismatch, and unequal lengths already differ.
  return left.length === right.length && timingSafeEqual(left, right)
}

// Mounted before the auth guard: the launcher polls it before anyone can log in.
// Without BOOKDOCK_LAUNCHER_NONCE (dev, and any launch not under the launcher)
// every request is a 404, so the route cannot leak the version anonymously.
internalRoutes.get('/version', (c) => {
  if (!nonceMatches(c.req.header('x-bookdock-launcher-nonce'))) return c.notFound()
  return c.json({ data: { version: BOOKDOCK_BUILD_INFO.version } satisfies InternalVersionRes })
})

export default internalRoutes
