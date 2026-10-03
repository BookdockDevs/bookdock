import { Hono } from 'hono'

import { ruleBatchDeleteSchema, tocRuleCreateSchema, tocRuleReorderSchema, tocRuleUpdateSchema } from '@bookdock/shared'

import { readRuleTransferFile } from '../../lib/rule-transfer'
import { AppError } from '../../middleware/error'

import { createTocRule, deleteTocRule, deleteTocRules, importTocRules, listTocRules, reorderTocRules, updateTocRule } from './toc-rules.service'
import { restoreTocRuleSeeds } from './seeds'

const tocRuleRoutes = new Hono()

tocRuleRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ data: [] })
  const items = listTocRules(user.id)
  return c.json({ data: items })
})

tocRuleRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  const body = await c.req.json()
  const parsed = tocRuleCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const rule = createTocRule(user.id, parsed.data)
  return c.json({ data: rule }, 201)
})

tocRuleRoutes.post('/seed', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  restoreTocRuleSeeds(user.id)
  const items = listTocRules(user.id)
  return c.json({ data: items })
})

tocRuleRoutes.post('/batch-delete', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') throw new AppError('FORBIDDEN', 'Guest sessions cannot manage TOC rules')
  const body = await c.req.json().catch(() => { throw new AppError('VALIDATION_ERROR', 'Invalid JSON') })
  const parsed = ruleBatchDeleteSchema.safeParse(body)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
  deleteTocRules(user.id, parsed.data.ruleIds)
  return c.json({ data: null })
})

tocRuleRoutes.post('/import', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  const body = await readRuleTransferFile(c)
  const imported = importTocRules(user.id, body)
  return c.json({ data: imported }, 201)
})

tocRuleRoutes.put('/reorder', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  const body = await c.req.json()
  const parsed = tocRuleReorderSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const items = reorderTocRules(user.id, parsed.data.tocRuleIds)
  return c.json({ data: items })
})

tocRuleRoutes.put('/:ruleId', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  const ruleId = c.req.param('ruleId')
  const body = await c.req.json()
  const parsed = tocRuleUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const rule = updateTocRule(user.id, ruleId, parsed.data)
  return c.json({ data: rule })
})

tocRuleRoutes.delete('/:ruleId', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage TOC rules' } }, 403)
  const ruleId = c.req.param('ruleId')
  await deleteTocRule(user.id, ruleId)
  return c.json({ data: null })
})

export default tocRuleRoutes
