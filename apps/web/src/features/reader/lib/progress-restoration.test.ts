import { describe, expect, it } from 'vitest'

import { getProgressRestoreTarget } from './progress-restoration'

describe('progress reader restoration', () => {
  it('restores the exact revision-scoped anchor CFI before fractional fallback', () => {
    expect(getProgressRestoreTarget({
      progressRevisionId: 'revision-2',
      positionAnchor: { revisionId: 'revision-2', cfi: 'epubcfi(/6/4!/4/2/1:25)' },
      cfi: null,
      percent: 45,
      fraction: 0.45,
    })).toEqual({ cfi: 'epubcfi(/6/4!/4/2/1:25)', contentCfi: 'epubcfi(/6/4!/4/2/1:25)', fraction: 0.45 })
  })

  it('does not use an anchor or percentage from an unavailable historical location', () => {
    expect(getProgressRestoreTarget({
      locationAvailable: false,
      progressRevisionId: 'revision-1',
      positionAnchor: { revisionId: 'revision-1', cfi: 'epubcfi(/6/2!/4/2/1:10)' },
      cfi: 'old-cfi',
      percent: 75,
      fraction: 0.75,
    })).toEqual({ cfi: '', contentCfi: '', fraction: undefined })
  })

  it('retains a layout coordinate and its content CFI for different renderers', () => {
    expect(getProgressRestoreTarget({ cfi: 'chapter:1:0.25', contentCfi: 'epubcfi(/6/4)', percent: 50, fraction: 0.5 }))
      .toEqual({ cfi: 'chapter:1:0.25', contentCfi: 'epubcfi(/6/4)', fraction: 0.5 })
  })

  it('uses percentage as the fractional fallback', () => {
    expect(getProgressRestoreTarget({ cfi: null, percent: 60 })).toEqual({ cfi: '', contentCfi: '', fraction: 0.6 })
  })
})
