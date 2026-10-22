import { describe, expect, it } from 'vitest'

import { clearActivityForLibraryNavigation, clearActivityForLibrarySwitch } from './library-search-state'

describe('library activity URL state', () => {
  it('preserves activity section when navigating to or toggling activity', () => {
    expect(clearActivityForLibraryNavigation({ section: 'activity', directory: undefined, page: undefined })).toEqual({
      section: 'activity',
      directory: undefined,
      page: undefined,
    })
  })

  it('keeps the selected activity while changing its activity filter', () => {
    expect(clearActivityForLibraryNavigation({ activityType: 'review' })).toEqual({ activityType: 'review' })
  })

  it('returns taxonomy and directory navigation to books and clears activity filters', () => {
    expect(clearActivityForLibraryNavigation({ category: 'category-1' })).toEqual({ category: 'category-1', section: undefined, activityType: undefined })
    expect(clearActivityForLibraryNavigation({ directory: 'tags' })).toEqual({ directory: 'tags', section: undefined, activityType: undefined })
  })

  it('drops activity state when switching to another library or private collection', () => {
    expect(clearActivityForLibrarySwitch({ libraryId: 'library-2' })).toEqual({ libraryId: 'library-2', section: undefined, activityType: undefined })
    expect(clearActivityForLibrarySwitch({ libraryId: undefined })).toEqual({ libraryId: undefined, section: undefined, activityType: undefined })
  })
})
