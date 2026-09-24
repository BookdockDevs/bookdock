import { describe, expect, it } from 'vitest'

import { indexRoute } from './index'

describe('library page search parameter', () => {
  const validateSearch = indexRoute.options.validateSearch

  it('keeps positive integer page numbers from links and navigation', () => {
    expect(validateSearch({ page: 3 }).page).toBe(3)
    expect(validateSearch({ page: '24' }).page).toBe(24)
  })

  it('defaults invalid page numbers to the first page', () => {
    for (const page of [undefined, 0, -1, 1.5, '1.5', 'abc', '0', Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateSearch({ page }).page).toBeUndefined()
    }
  })
})
