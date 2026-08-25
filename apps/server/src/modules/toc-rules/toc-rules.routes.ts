import { Hono } from 'hono'

import { tocRuleCreateSchema, tocRuleReorderSchema, tocRuleUpdateSchema } from '@bookdock/shared'

import { createTocRule, deleteTocRule, listTocRules, reorderTocRules, updateTocRule } from './toc-rules.service'
import { restoreTocRuleSeeds } from './seeds'

const tocRuleRoutes = new Hono()

tocRuleRoutes.get('/', async (c) => {
  const user = c.get('user')
  const items = listTocRules(user.id)
  return c.json({ data: items })
})

tocRuleRoutes.post('/', async (c) => {
  const user = c.get('user')
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
  restoreTocRuleSeeds(user.id)
  const items = listTocRules(user.id)
  return c.json({ data: items })
})

tocRuleRoutes.put('/reorder', async (c) => {
  const user = c.get('user')
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
  const ruleId = c.req.param('ruleId')
  await deleteTocRule(user.id, ruleId)
  return c.json({ data: null })
})

export default tocRuleRoutes