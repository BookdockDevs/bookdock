import { describe, it, expect } from 'vitest'

import type { BookMetadataSourceRes } from '@bookdock/shared'

import {
  applySourceAllToDraft,
  canRestoreField,
  draftFieldDiffers,
  sourceTextForField,
} from '../features/library/components/book-detail/metadata-source'
import { draftToBookmetaPreserving, type MetaDraft } from '../features/library/components/book-detail/types'

const draft: MetaDraft = {
  title: 'Edited',
  authors: 'A、B',
  publisher: 'Edited Press',
  published: '',
  isbn: '',
  language: '',
  subjects: 'x, y',
  series: 'S',
  seriesIndex: '1',
  description: 'd',
  coverPaletteId: null,
}

function fileSource(values: Partial<BookMetadataSourceRes['values']>): BookMetadataSourceRes {
  return {
    kind: 'file',
    format: 'epub',
    fileName: 'a.epub',
    normalizeTitleApplied: false,
    values: {
      title: null, authors: null, description: null, publisher: null,
      published: null, language: null, isbn: null, subjects: null,
      series: null, seriesIndex: null, ...values,
    },
    provenance: {
      title: 'file', authors: 'file', description: 'file', publisher: 'file',
      published: 'missing', language: 'missing', isbn: 'missing', subjects: 'file',
      series: 'file', seriesIndex: 'file',
    },
  }
}

describe('metadata source draft helpers', () => {
  it('shows restore only when the source has a value and differs', () => {
    const source = fileSource({ title: 'File Title' })
    expect(canRestoreField('title', 'Edited', source)).toBe(true)
    expect(canRestoreField('title', 'File Title', source)).toBe(false)
    expect(canRestoreField('publisher', 'Edited Press', fileSource({ publisher: null }))).toBe(false)
  })

  it('compares author lists and subjects by parsed values, not raw separators', () => {
    const source = fileSource({ authors: ['A', 'B'] })
    expect(draftFieldDiffers('authors', 'A、B', source.values)).toBe(false)
    expect(draftFieldDiffers('authors', 'A, B', source.values)).toBe(false)
    expect(draftFieldDiffers('authors', 'A', source.values)).toBe(true)
    const subjects = fileSource({ subjects: ['x', 'y'] })
    expect(draftFieldDiffers('subjects', 'x, y', subjects.values)).toBe(false)
    expect(draftFieldDiffers('subjects', 'x、y', subjects.values)).toBe(false)
  })

  it('treats seriesIndex 0 as a real value and isolates series name', () => {
    const source = fileSource({ series: 'S2', seriesIndex: 0 })
    expect(sourceTextForField('seriesIndex', source.values)).toBe('0')
    expect(draftFieldDiffers('seriesIndex', '', source.values)).toBe(true)
    expect(draftFieldDiffers('seriesIndex', '0', source.values)).toBe(false)
    const next = applySourceAllToDraft(draft, source, ['series', 'seriesIndex'])
    expect(next.series).toBe('S2')
    expect(next.seriesIndex).toBe('0')
    expect(next.title).toBe('Edited')
  })

  it('clears missing source fields on reset-all but keeps personal drafts', () => {
    const source = fileSource({ title: 'File', authors: ['FA'] })
    const next = applySourceAllToDraft(
      { ...draft, publisher: 'Keep?', coverPaletteId: 'sand' as never },
      source,
      ['title', 'authors', 'description', 'publisher', 'published', 'language', 'isbn', 'subjects', 'series', 'seriesIndex'],
    )
    expect(next.title).toBe('File')
    expect(next.authors).toBe('FA')
    expect(next.publisher).toBe('')
    expect(next.coverPaletteId).toBe('sand')
  })

  it('preserves unowned bookmeta keys on save', () => {
    const next = draftToBookmetaPreserving(
      { publisher: 'Old', identifier: 'id-1', rights: 'r', contributors: [{ name: 'c' }] },
      { ...draft, publisher: '' },
    )
    expect(next.identifier).toBe('id-1')
    expect(next.rights).toBe('r')
    expect(next.publisher).toBeUndefined()
  })
})
