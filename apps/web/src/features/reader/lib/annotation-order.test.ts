import { describe, expect, it } from 'vitest'

import type { AnnotationRes } from '@bookdock/shared'

import { compareAnnotations, groupAnnotationsByChapter } from './annotation-order'

function annotation(overrides: Partial<AnnotationRes> & { id: string }): AnnotationRes {
  return {
    bookId: 'v1',
    cfiRange: 'cfi',
    cfiAnchor: null,
    type: 'highlight',
    color: 'yellow',
    style: 'highlight',
    text: 'quote',
    note: null,
    chapter: null,
    chapterHref: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('compareAnnotations', () => {
  it('orders by CFI position before creation time', () => {
    const first = annotation({ id: 'a', cfiRange: 'epubcfi(/6/2!/4/2)', createdAt: 200 })
    const second = annotation({ id: 'b', cfiRange: 'epubcfi(/6/2!/4/10)', createdAt: 100 })
    expect([second, first].sort(compareAnnotations)).toEqual([first, second])
  })

  it('falls back to creation time and id', () => {
    const older = annotation({ id: 'a', createdAt: 100 })
    const newer = annotation({ id: 'b', createdAt: 200 })
    expect([newer, older].sort(compareAnnotations)).toEqual([older, newer])
    const sameTimeA = annotation({ id: 'a', createdAt: 100 })
    const sameTimeB = annotation({ id: 'b', createdAt: 100 })
    expect([sameTimeB, sameTimeA].sort(compareAnnotations)).toEqual([sameTimeA, sameTimeB])
  })
})

describe('groupAnnotationsByChapter', () => {
  it('groups by href first, then label, keeping first-seen order', () => {
    const items = [
      annotation({ id: 'a', chapter: '第一章', chapterHref: 'ch1.xhtml' }),
      annotation({ id: 'b', chapter: '第一章 (renamed)', chapterHref: 'ch1.xhtml' }),
      annotation({ id: 'c', chapter: '第二章' }),
      annotation({ id: 'd', chapter: null, chapterHref: null }),
    ]
    const groups = groupAnnotationsByChapter(items, '未分类')
    expect(groups.map((g) => g.key)).toEqual(['href:ch1.xhtml', 'label:第二章', 'label:未分类'])
    expect(groups[0].list.map((a) => a.id)).toEqual(['a', 'b'])
    expect(groups[0].chapter).toBe('第一章')
  })
})
