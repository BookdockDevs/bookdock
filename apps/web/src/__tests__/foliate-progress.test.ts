import { describe, expect, it, vi } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { PageProgress, SectionProgress } from '../../public/foliate-js/progress.js'

describe('foliate PageProgress', () => {
  it('converts a CFI anchor into byte-independent section progress', async () => {
    const doc = new DOMParser().parseFromString('<html><body><p>abcd</p><p>efgh</p></body></html>', 'application/xhtml+xml')
    const createDocument = vi.fn(async () => doc)
    const progress = new PageProgress(
      { sections: [{ createDocument }] },
      () => ({
        index: 0,
        anchor: (target: Document) => {
          const range = target.createRange()
          range.setStart(target.querySelector('p')!.firstChild!, 2)
          range.collapse(true)
          return range
        },
      }),
    )

    expect(await progress.getProgress('epubcfi(/6/2!/4/2:2)')).toEqual({
      fraction: 0.25,
      index: 0,
    })
    expect(await progress.getProgress('epubcfi(/6/2!/4/2:2)')).toEqual({
      fraction: 0.25,
      index: 0,
    })
    expect(createDocument).toHaveBeenCalledTimes(1)
  })

  it('returns a stable zero progress for empty sections', () => {
    const progress = new SectionProgress([{ linear: 'yes', size: 0 }], 1500, 1600)

    expect(progress.sectionFractions).toEqual([0, 0])
    expect(progress.getProgress(0, 0.5)).toMatchObject({
      fraction: 0,
      location: { total: 0 },
      time: { section: 0, total: 0 },
    })
  })

  it('keeps viewport-start progress separate from the visible page tail', () => {
    const progress = new SectionProgress([{ linear: 'yes', size: 100 }], 1500, 1600)

    expect(progress.getProgress(0, 0.4, 0.2)).toMatchObject({
      fraction: 0.6,
      startFraction: 0.4,
    })
  })
})
