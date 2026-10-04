import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseLibrarySearch } from '@bookdock/shared'

import * as client from '../../db/client'
import { compileSearchExpression } from './search-expression'

describe('search expression compilation work', () => {
  beforeEach(() => {
    vi.spyOn(client, 'getDb').mockImplementation(() => { throw new Error('Unexpected taxonomy read') })
  })
  it.each(['ordinary words', 'word format:epub', '!word | another', 'status:reading'])('does not read taxonomy for %s', (source) => {
    const leaf = vi.fn(() => sql`1`)
    expect(compileSearchExpression(JSON.stringify(parseLibrarySearch(source)), 'private-library', false, leaf)).toBeTruthy()
    expect(leaf).toHaveBeenCalled()
    expect(client.getDb).not.toHaveBeenCalled()
  })
  it('still rejects private-only status in a shared library without taxonomy reads', () => {
    expect(() => compileSearchExpression(JSON.stringify(parseLibrarySearch('status:reading')), 'shared-library', true, () => sql`1`))
      .toThrow('Invalid search expression')
    expect(client.getDb).not.toHaveBeenCalled()
  })
})
