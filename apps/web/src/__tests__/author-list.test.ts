import { describe, expect, it } from 'vitest'

import { formatAuthorList } from '@/lib/utils'
import { parseAuthorList } from '@/features/library/components/book-detail/types'

describe('formatAuthorList', () => {
  it('joins the full list and falls back to the mirror', () => {
    expect(formatAuthorList(['甲', '乙'], '甲')).toBe('甲、乙')
    expect(formatAuthorList([], '甲')).toBe('甲')
    expect(formatAuthorList(undefined, '')).toBe('')
  })
})

describe('parseAuthorList', () => {
  it('splits on CJK and ASCII separators, dedupes and caps', () => {
    expect(parseAuthorList('甲、乙,丙，丁；戊;己')).toEqual(['甲', '乙', '丙', '丁', '戊', '己'])
    expect(parseAuthorList('甲、甲、 乙 ')).toEqual(['甲', '乙'])
    expect(parseAuthorList('')).toEqual([])
    expect(parseAuthorList(Array.from({ length: 12 }, (_, i) => `作者${i}`).join('、'))).toHaveLength(10)
  })
})
