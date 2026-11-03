import { describe, expect, it } from 'vitest'

import { consumeImportPreview, saveImportPreview } from './preview-store'

const proposal = { books: [], notes: [], reviews: [], durationFacts: [], skipped: 0, unprocessable: [] }

describe('reading import preview snapshots', () => {
  it('binds a single-use preview to its owner and keeps the source proposal unchanged', () => {
    const previewId = saveImportPreview({ userId: 'owner', source: 'legado', datasetKey: '', scope: 'all', proposal })

    expect(() => consumeImportPreview(previewId, 'other')).toThrow()
    expect(consumeImportPreview(previewId, 'owner')).toMatchObject({ source: 'legado', scope: 'all', proposal })
    expect(() => consumeImportPreview(previewId, 'owner')).toThrow()
  })
})
