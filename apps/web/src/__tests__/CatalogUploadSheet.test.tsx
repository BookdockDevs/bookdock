import { describe, it, expect } from 'vitest'

import { catalogUploadFields } from '../features/library/catalog-upload'

describe('catalogUploadFields', () => {
  it('files the upload under the category in context', () => {
    expect(catalogUploadFields('cat-1')).toEqual({ categoryId: 'cat-1' })
  })

  it('files under no category for uncategorized or unsettled context', () => {
    expect(catalogUploadFields(null)).toEqual({})
    expect(catalogUploadFields(undefined)).toEqual({})
  })
})
