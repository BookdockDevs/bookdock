import { describe, expect, it } from 'vitest'

import type { ClientCategoryView } from '@bookdock/shared'

import { matchCategoryByName } from './taxonomy'

function category(id: string, name: string): ClientCategoryView {
  return { id, libraryId: 'lib', userId: 'user', name, parentId: null, sortOrder: 0, pinned: false, hidden: false, createdAt: 0, updatedAt: 0, bookCount: 0, subtreeBookCount: 0 }
}

describe('matchCategoryByName', () => {
  it('matches an existing name exactly, ignoring case and padding', () => {
    const categories = [category('1', '小说'), category('2', '轻小说')]
    expect(matchCategoryByName(categories, '轻小说')?.id).toBe('2')
    expect(matchCategoryByName(categories, ' 轻小说 ')?.id).toBe('2')
  })

  it('never widens to a broader category that shares a substring', () => {
    // Categories resolve like tags: a near miss is created on save rather than
    // silently filed under something the user did not choose.
    expect(matchCategoryByName([category('1', '都市')], '都市生活')).toBeUndefined()
    expect(matchCategoryByName([category('1', '小说')], '科幻小说')).toBeUndefined()
    expect(matchCategoryByName([category('1', '小说')], '轻小说')).toBeUndefined()
    expect(matchCategoryByName([category('1', '小说'), category('2', '科幻小说')], '硬核科幻小说')).toBeUndefined()
  })

  it('returns undefined for an empty or unmatched name', () => {
    expect(matchCategoryByName([category('1', '小说')], '  ')).toBeUndefined()
    expect(matchCategoryByName([category('1', '小说')], '玄幻')).toBeUndefined()
    expect(matchCategoryByName([], '小说')).toBeUndefined()
  })
})
