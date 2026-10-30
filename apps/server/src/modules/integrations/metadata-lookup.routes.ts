import { Hono } from 'hono'
import { metadataConfigUpdateSchema, metadataConnectionTestSchema, metadataCoverSchema, metadataDetailSchema, metadataSearchSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { fetchMetadataCover, getDoubanMetadata, metadataConfiguration, searchMetadata, updateMetadataSecret } from './metadata-lookup.service'
import { getWeReadKey, getWeReadMetadata, searchWeRead } from './weread.service'

const routes = new Hono()
const recentSearches = new Map<string, number[]>()

function limitRequests(userId: string) {
  const now = Date.now()
  for (const [id, times] of recentSearches) if (!times.some((time) => now - time < 60_000)) recentSearches.delete(id)
  const recent = (recentSearches.get(userId) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= 30) throw new AppError('VALIDATION_ERROR', 'Too many metadata requests; try again later')
  recentSearches.set(userId, [...recent, now])
}

routes.use('*', async (c, next) => {
  if (!c.get('user') || c.get('guest')) throw new AppError('UNAUTHORIZED', 'Login required')
  await next()
})

routes.get('/config', (c) => c.json({ data: metadataConfiguration(c.get('user')!.id) }))

routes.put('/config', async (c) => {
  const parsed = metadataConfigUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid metadata configuration')
  return c.json({ data: updateMetadataSecret(parsed.data.provider, parsed.data.key, c.get('user')!.id) })
})

routes.post('/test', async (c) => {
  const parsed = metadataConnectionTestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid connection test')
  limitRequests(c.get('user')!.id)
  await searchMetadata(parsed.data.provider, 'The Hobbit', parsed.data.key, c.get('user')!.id)
  return c.json({ data: { success: true } })
})

routes.post('/search', async (c) => {
  const parsed = metadataSearchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid metadata search')
  limitRequests(c.get('user')!.id)
  if (parsed.data.provider === 'weread') {
    const key = getWeReadKey(c.get('user')!.id)
    if (!key) throw new AppError('VALIDATION_ERROR', 'WeRead API key is not configured')
    return c.json({ data: await searchWeRead(key, parsed.data.query, parsed.data.weReadScope) })
  }
  return c.json({ data: await searchMetadata(parsed.data.provider, parsed.data.query, undefined, c.get('user')!.id) })
})

routes.post('/detail', async (c) => {
  const parsed = metadataDetailSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid metadata detail request')
  limitRequests(c.get('user')!.id)
  if (parsed.data.provider === 'douban') return c.json({ data: await getDoubanMetadata(parsed.data.id) })
  const key = getWeReadKey(c.get('user')!.id)
  if (!key) throw new AppError('VALIDATION_ERROR', 'WeRead API key is not configured')
  return c.json({ data: await getWeReadMetadata(key, parsed.data.id) })
})

routes.post('/cover', async (c) => {
  const parsed = metadataCoverSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid cover request')
  limitRequests(c.get('user')!.id)
  const cover = await fetchMetadataCover(parsed.data.provider, parsed.data.url)
  return c.body(Uint8Array.from(cover.bytes), 200, { 'Content-Type': cover.contentType, 'Cache-Control': 'no-store' })
})

export default routes
