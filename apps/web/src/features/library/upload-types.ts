import type { BookUploadRes } from '@bookdock/shared'

export type UploadItemStatus = 'pending' | 'queued' | 'uploading' | 'processing' | 'success' | 'duplicate' | 'corresponding' | 'error'

export interface UploadItemView {
  id: string
  name: string
  status: UploadItemStatus
  progress: number
  messageKey?: string
  /** Client-owned transport errors; never unfiltered server messages. */
  message?: string
  /**
   * Whether this failure can be retried with the same input. Permanent verdicts
   * about the file (too large, unsupported) are false: the row then points at
   * re-adding instead of offering a button that must fail identically.
   */
  retryable?: boolean
  bookVersionId?: string
  corresponding?: BookUploadRes['corresponding']
}
