import { expect, it } from 'vitest'

import { createTextCache } from '../eink/text-cache'

it('bounds text by estimated bytes and item count, and keeps recently used entries', () => {
  const cache = createTextCache()
  for (let i = 0; i < 5; i++) cache.set(String(i), 'text')
  expect(cache.get('0')).toBe('text')
  cache.set('5', 'text')
  expect(cache.get('1')).toBeUndefined()
  expect(cache.get('0')).toBe('text')
  cache.set('large', 'x'.repeat(2 * 1024 * 1024))
  expect(cache.get('large')).toBeDefined()
  expect(cache.get('0')).toBeUndefined()
  cache.set('oversized', 'x'.repeat(2 * 1024 * 1024 + 1))
  expect(cache.get('oversized')).toBeUndefined()
  expect(cache.get('large')).toBeDefined()
})
