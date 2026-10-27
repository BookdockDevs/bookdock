import { describe, expect, it } from 'vitest'

import { cfiSpineIndex, createEpubCfiTextOffset, createEpubCfiTextRange, resolveEpubCfiTextOffset, resolveEpubCfiTextRange, resolveEpubCfiTextStart } from './epub-cfi-position'

describe('EPUB CFI position resolution', () => {
  it('resolves a point into body text without using a whole-book fraction', () => {
    const markup = '<html><head></head><body><p>alpha<![CDATA[ beta]]></p><p>gamma</p></body></html>'

    expect(cfiSpineIndex('epubcfi(/6/4[chapter]!/4/2/1:3)')).toBe(1)
    expect(cfiSpineIndex('epubcfi(/6/4[chapter]!/4/2/1:3)', 0)).toBe(1)
    expect(resolveEpubCfiTextOffset(markup, 'epubcfi(/6/2[item]!/4/2/1:7)')).toBe(7)
  })

  it('maps point and range CFIs to offsets and back', () => {
    const markup = '<html><head></head><body><p>alpha</p></body></html>'

    const point = createEpubCfiTextOffset(markup, 0, 3)
    const range = createEpubCfiTextRange(markup, 0, 1, 4)
    expect(point).not.toBeNull()
    expect(range).not.toBeNull()
    expect(resolveEpubCfiTextOffset(markup, point!)).toBe(3)
    expect(resolveEpubCfiTextRange(markup, range!)).toEqual({ start: 1, end: 4 })
    expect(resolveEpubCfiTextStart(markup, range!)).toBe(1)
    expect(resolveEpubCfiTextOffset(markup, 'epubcfi(/6/2!/99/1:1)')).toBeNull()
    expect(resolveEpubCfiTextOffset(markup, 'epubcfi(/6/2!/4/2/1:999)')).toBeNull()
    expect(resolveEpubCfiTextRange(markup, 'epubcfi(/6/2!/4/2,/1:1,/99:3)')).toBeNull()
    expect(cfiSpineIndex('epubcfi(/6/3[item]!/4/2/1:3)')).toBeNull()
  })
})
