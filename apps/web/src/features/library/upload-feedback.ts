import type { UploadItemView } from './upload-types'

export function uploadFeedback(items: readonly UploadItemView[], translate: (key: string, params?: Record<string, string | number>) => string) {
  const succeeded = items.filter((item) => item.status === 'success').length
  const duplicated = items.filter((item) => item.status === 'duplicate').length
  const failed = items.filter((item) => item.status === 'error').length
  if (failed > 0 || (succeeded > 0 && duplicated > 0)) {
    const type = failed > 0 ? (succeeded + duplicated > 0 ? 'warning' : 'error') : 'info'
    const message = [
      succeeded > 0 && translate('library.uploadSummarySucceeded', { count: succeeded }),
      duplicated > 0 && translate('library.uploadSummaryDuplicated', { count: duplicated }),
      failed > 0 && translate('library.uploadSummaryFailed', { count: failed }),
    ].filter(Boolean).join(translate('library.uploadSummarySeparator'))
    return { type, message } as const
  }
  if (duplicated > 0) return { type: 'info', message: { key: 'library.uploadDuplicateOnly', params: { count: duplicated } } } as const
  if (succeeded > 0) return { type: 'success', message: { key: 'library.uploadImported', params: { count: succeeded } } } as const
  return null
}
