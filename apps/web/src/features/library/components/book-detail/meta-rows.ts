import i18n from 'i18next'

import type { BookMetadata } from '@bookdock/shared'

import { formatBytes, formatDate, formatDateTime } from '@/lib/utils'

import type { MetaRow } from './MetaGrid'
import type { EditableMetadataField } from './metadata-field'
import { formatLanguage, formatWordCount, isMachineIdentifier } from './types'

/** What a detail body knows about the book on screen, whichever side it lives on. */
export interface MetaRowValues {
  bookmeta?: BookMetadata | null
  format: string
  size: number | null
  wordCount?: number | null
  createdAt: number
  updatedAt: number
  fileName?: string | null
}

export interface MetaRowOptions {
  t: (key: string, variables?: Record<string, string | number>) => string
  /** Series rows turn into a filter for that series. */
  onFilterSeries?: (series: string) => void
  /** Returns undefined for a field this caller may not edit. */
  onEdit?: (field: EditableMetadataField, label: string) => (() => void) | undefined
}

const groupDigits = (value: number): string => new Intl.NumberFormat(i18n.language).format(value)

/**
 * The fact grid's rows. Both detail bodies built this list themselves - the
 * same fields in the same order, differing only in where the values came from -
 * so the order and the wording live here once. The caller supplies values and
 * the two callbacks it can honour; a caller that cannot edit a field simply
 * passes an `onEdit` that answers undefined for it.
 */
export function buildMetaRows(values: MetaRowValues, { t, onFilterSeries, onEdit }: MetaRowOptions): MetaRow[] {
  const { bookmeta, format, size, wordCount, createdAt, updatedAt, fileName } = values
  const edit = (field: EditableMetadataField, label: string) => onEdit?.(field, label)
  const rows: MetaRow[] = []

  if (bookmeta?.series) {
    const series = bookmeta.series
    rows.push({
      label: t('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${series} #${bookmeta.seriesIndex}` : series,
      onClick: onFilterSeries ? () => onFilterSeries(series) : undefined,
      onEdit: edit('series', t('library.seriesSection')),
    })
  }
  if (bookmeta?.publisher) rows.push({ label: t('library.publisher'), value: bookmeta.publisher, onEdit: edit('publisher', t('library.publisher')) })
  if (bookmeta?.published) rows.push({ label: t('library.published'), value: bookmeta.published, onEdit: edit('published', t('library.published')) })
  if (bookmeta?.language) {
    rows.push({ label: t('library.language'), value: formatLanguage(bookmeta.language, i18n.language), onEdit: edit('language', t('library.language')) })
  }
  const rawIdentifier = bookmeta?.isbn || bookmeta?.identifier || ''
  if (rawIdentifier && (bookmeta?.isbn || !isMachineIdentifier(rawIdentifier))) {
    rows.push({
      label: bookmeta?.isbn ? 'ISBN' : t('library.identifier'),
      value: rawIdentifier,
      copyable: true,
      hint: t('library.copyValue'),
      onEdit: bookmeta?.isbn ? edit('isbn', 'ISBN') : undefined,
    })
  }
  rows.push({ label: t('library.format'), value: format.toUpperCase() })
  rows.push({ label: t('library.sortBy.size'), value: formatBytes(size), hint: size === null ? undefined : `${groupDigits(size)} B` })
  if (wordCount != null) {
    rows.push({
      label: t('library.wordCount'),
      value: formatWordCount(wordCount, i18n.language, t),
      hint: t('library.tocRuleWords', { count: groupDigits(wordCount) }),
    })
  }
  rows.push({ label: t('library.addedAt'), value: formatDate(createdAt), hint: formatDateTime(createdAt) })
  if (updatedAt !== createdAt) {
    rows.push({ label: t('library.updatedAt'), value: formatDate(updatedAt), hint: formatDateTime(updatedAt) })
  }
  if (bookmeta?.subjects?.length) {
    rows.push({ label: t('library.subjects'), value: bookmeta.subjects.join('、'), expandable: true, onEdit: edit('subjects', t('library.subjects')) })
  }
  if (fileName) {
    rows.push({ label: t('library.originalFile'), value: fileName, copyable: true, expandable: true, hint: t('library.copyFullFileName') })
  }
  return rows
}
