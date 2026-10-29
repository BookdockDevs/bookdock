import { expect, it } from 'vitest'

import { createImageCache } from '../eink/image-cache'

it('reuses recent images while bounding compressed blob storage', () => {
  const cache = createImageCache()
  const image = new Blob([new Uint8Array(2 * 1024 * 1024)])
  cache.set('cover', image)
  cache.set('header', image)
  expect(cache.get('cover')).toBe(image)
  cache.set('new', image)
  expect(cache.get('header')).toBeUndefined()
  expect(cache.get('cover')).toBe(image)
  cache.set('large', new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]))
  expect(cache.get('large')).toBeUndefined()
})
