import { describe, expect, it } from 'vitest'

import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { createEpubRevisionMap } from './epub-revision-map'
import { projectRevisionCoverage } from './revision-map'

describe('EPUB revision mapping', () => {
  it('keeps text offsets separate from spine files and recognizes structure-only headings', async () => {
    const before = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '第一章', level: 0 },
      { id: 'two', title: '第二章', level: 0 },
    ], (index) => index === 0 ? '第一段未修改正文。' : '第二段未修改正文。')
    const after = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '第一章', level: 0 },
      { id: 'two', title: '新标题', level: 0 },
    ], (index) => index === 0 ? '第一段未修改正文。' : '第二段未修改正文。')

    const result = await createEpubRevisionMap(before, after)
    expect(result.sourceSections).toHaveLength(2)
    expect(result.targetSections).toHaveLength(2)
    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSpineHref: expect.any(String), targetSpineHref: expect.any(String) }),
    ]))
    expect(result.structuralRanges).toHaveLength(0)
  })

  it('does not inherit coverage onto inserted body text', async () => {
    const before = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '第一章', level: 0 },
    ], () => '原文开头。'.repeat(20) + '原文结尾。'.repeat(20))
    const after = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '第一章', level: 0 },
    ], () => '原文开头。'.repeat(20) + '新增正文不能继承已读覆盖。'.repeat(10) + '原文结尾。'.repeat(20))
    const mapping = await createEpubRevisionMap(before, after)
    const projected = projectRevisionCoverage(
      [[0, 1]], mapping.sourceSections, mapping.targetSections, mapping.segments, mapping.structuralRanges,
    )

    expect(projected.reduce((sum, [start, end]) => sum + end - start, 0)).toBeLessThan(1)
  })

  it('maps unchanged text in every spine document including each chapter start', async () => {
    const chapters = ['第一章正文'.repeat(24), '第二章正文'.repeat(24), '第三章正文'.repeat(24)]
    const archive = await convertTxtToEpub({ title: 'Book', id: 'book' }, chapters.map((_, index) => ({
      id: `chapter-${index}`, title: `章节${index + 1}`, level: 0,
    })), (index) => chapters[index]!)
    const mapping = await createEpubRevisionMap(archive, archive)

    expect(new Set(mapping.segments.map((segment) => segment.sourceSpineHref))).toEqual(new Set(mapping.sourceSections.map((section) => section.spineHref)))
    const projected = projectRevisionCoverage([[0, 1]], mapping.sourceSections, mapping.targetSections, mapping.segments)
    expect(projected).toEqual([[0, 1]])
  })

  it('does not map identical chapter text to a reindexed file after deletion', async () => {
    const duplicate = '相同章节标题\n\n这两章正文完全相同，无法确认保留的是哪一份。'
    const before = await convertTxtToEpub({ title: 'Book', id: 'Book' }, [
      { id: 'one', title: '相同章节标题', level: 0 },
      { id: 'two', title: '相同章节标题', level: 0 },
    ], () => duplicate)
    const after = await convertTxtToEpub({ title: 'Book', id: 'Book' }, [
      { id: 'two', title: '相同章节标题', level: 0 },
    ], () => duplicate)

    const mapping = await createEpubRevisionMap(before, after)
    expect(mapping.segments).toEqual([])
  })

  it('keeps a pure split fully covered when its new heading is marked structural', async () => {
    const first = Array.from({ length: 20 }, (_, index) => `原章节正文前半部分第${index}段，有稳定且唯一的内容。`).join('')
    const second = Array.from({ length: 20 }, (_, index) => `原章节正文后半部分第${index}段，保留各自不同的信息。`).join('')
    const before = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '原章节', level: 0 },
    ], () => `${first}\n\n${second}`)
    const after = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: '原章节', level: 0 },
      { id: 'split', title: '新章节', level: 0 },
    ], (index) => index === 0 ? first : second)
    const mapping = await createEpubRevisionMap(before, after, [1])
    const projected = projectRevisionCoverage(
      [[0, 1]], mapping.sourceSections, mapping.targetSections, mapping.segments, mapping.structuralRanges,
    )
    expect(projected).toEqual([[0, 1]])
  })
})
