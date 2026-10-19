import { describe, expect, it } from 'vitest'

import { archiveRoute } from '@/routes/archive'

describe('archiveRoute validateSearch', () => {
  const validate = archiveRoute.options.validateSearch!

  it('preserves both data and notes views for book archive', () => {
    expect(validate({ bookId: 'b1', bookView: 'notes' })).toMatchObject({
      bookId: 'b1',
      bookView: 'notes',
    })

    expect(validate({ bookId: 'b1', bookView: 'data' })).toMatchObject({
      bookId: 'b1',
      bookView: 'data',
    })

    expect(validate({ bookId: 'b1', bookView: 'invalid' })).toMatchObject({
      bookId: 'b1',
      bookView: undefined,
    })
  })
})
