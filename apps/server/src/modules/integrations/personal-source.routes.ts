import { Hono } from 'hono'
import { personalSourceGitHubInstallSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { installPersonalSourceFromGitHub, installPersonalSourceFromZip } from './personal-source-install'
import { getPersonalSourceIcon, listPersonalSources, removePersonalSource } from './personal-source.service'

const routes = new Hono()
const recentInstalls = new Map<string, number[]>()

function limitInstallations(userId: string) {
  const now = Date.now()
  for (const [id, times] of recentInstalls) if (!times.some((time) => now - time < 60_000)) recentInstalls.delete(id)
  const recent = (recentInstalls.get(userId) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= 10) throw new AppError('VALIDATION_ERROR', 'Too many source installs; try again later')
  recentInstalls.set(userId, [...recent, now])
}

routes.use('*', async (c, next) => {
  if (!c.get('user') || c.get('guest')) throw new AppError('UNAUTHORIZED', 'Login required')
  await next()
})

routes.get('/', (c) => c.json({ data: listPersonalSources(c.get('user')!.id) }))

routes.post('/install/github', async (c) => {
  limitInstallations(c.get('user')!.id)
  const parsed = personalSourceGitHubInstallSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid GitHub source URL')
  return c.json({ data: await installPersonalSourceFromGitHub(c.get('user')!.id, parsed.data.url) })
})

routes.post('/install/zip', async (c) => {
  limitInstallations(c.get('user')!.id)
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'Expected a ZIP package upload')
  return c.json({ data: await installPersonalSourceFromZip(c.get('user')!.id, file) })
})

routes.delete('/:sourceId', async (c) => {
  await removePersonalSource(c.get('user')!.id, c.req.param('sourceId'))
  return c.json({ data: { success: true } }, 200)
})

routes.get('/:sourceId/icon', async (c) => {
  const icon = await getPersonalSourceIcon(c.get('user')!.id, c.req.param('sourceId'))
  return c.body(Uint8Array.from(icon.data), 200, { 'Content-Type': icon.contentType, 'Cache-Control': 'no-store' })
})

export default routes
