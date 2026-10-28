import { expect, it } from 'vitest'

import { getShelfLayout } from '../eink/shelf-layout'

it('chooses complete rows for compact, tall, wide and short viewports', () => {
  expect(getShelfLayout(432, 475)).toEqual({ columns: 4, coverWidth: 96, pageSize: 8 })
  expect(getShelfLayout(632, 1000)).toEqual({ columns: 5, coverWidth: 113, pageSize: 20 })
  expect(getShelfLayout(220, 430)).toEqual({ columns: 2, coverWidth: 102, pageSize: 2 })
  expect(getShelfLayout(432, 160)).toEqual({ columns: 4, coverWidth: 70, pageSize: 4 })
  expect(getShelfLayout(912, 10000).pageSize).toBeLessThanOrEqual(100)
})
