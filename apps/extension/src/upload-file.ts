import type { ExternalUploadRes } from '@bookdock/shared'

import { getErrorKeyByCode } from '../../web/src/lib/error-keys'

import { testConnectionOnce } from './connection'
import { t } from './i18n'
import { readerUrl, validateFile } from './model'
import { claimJob, completeJob, failJob, renewLease } from './store'
import { errorText } from './ui'
import { translate } from './useTranslation'

function uploadError(status: number, code?: string): string {
  if (status === 401) return t('error.tokenInvalid')
  if (status === 403) return t('error.tokenForbidden')
  if (status === 413 || code === 'UPLOAD_TOO_LARGE') return t('error.uploadTooLarge')
  const key = getErrorKeyByCode(code)
  if (key) return translate(key)
  if (status >= 500) return t('error.instanceDown', { status })
  return translate('library.uploadFailed')
}

/**
 * Verdicts about the file itself. The bytes that would be re-sent are identical,
 * so a retry can only produce the same answer; the row offers "re-add" instead.
 * Transient conditions (network, 5xx, a stale token) stay retryable.
 */
function permanentVerdict(status: number, code?: string): boolean {
  return status === 413 || code === 'UPLOAD_TOO_LARGE' || code === 'UNSUPPORTED_FORMAT' || code === 'VALIDATION_ERROR'
}

class UploadFailure extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message) }
}

export async function uploadFile(id: string, onProgress: (progress: number) => void, signal: AbortSignal): Promise<void> {
  const lease = crypto.randomUUID()
  let timer: ReturnType<typeof setInterval> | undefined
  let request: XMLHttpRequest | undefined
  // The two aborts have different owners: the reader stopped the batch, or the background
  // decided this page no longer holds the job. Reporting the second as "cancelled" blames
  // the reader for something they did not do.
  let lost = false
  const abort = (reason?: 'lease') => { if (reason === 'lease') lost = true; request?.abort() }
  const onAbort = () => abort()
  signal.addEventListener('abort', onAbort)
  try {
    const claimed = await claimJob(id, lease)
    timer = setInterval(() => { void renewLease(id, lease).then((valid) => { if (!valid) abort('lease') }, () => abort('lease')) }, 15_000)
    // Shared between files of the same batch: the probe is about the connection, not this file.
    const tested = await testConnectionOnce(claimed.connection.baseUrl, claimed.connection.token)
    if (tested.userId !== claimed.connection.userId) throw new Error(t('error.connChanged'))
    try { validateFile(claimed.file.name, claimed.file.size, tested.uploadMaxBytes) } catch (error) { throw new UploadFailure(errorText(error), false) }
    if (signal.aborted) throw new Error(t('error.cancelled'))
    // A lease that lapsed means the background gave up on this job, not that the account moved.
    if (!await renewLease(id, lease)) throw new Error(t('error.uploadInterrupted'))
    const form = new FormData()
    form.append('file', claimed.file)
    const uploaded = await new Promise<ExternalUploadRes>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      request = xhr
      xhr.open('POST', `${claimed.connection.baseUrl}/api/v1/ext/books`)
      xhr.setRequestHeader('Authorization', `Bearer ${claimed.connection.token}`)
      xhr.responseType = 'json'
      xhr.timeout = 10 * 60 * 1000
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
      xhr.onload = () => {
        const response = xhr.response as { data?: ExternalUploadRes; error?: { code?: string } } | null
        try {
          if (xhr.status === 201 && response?.data && new URL(xhr.responseURL).origin === new URL(claimed.connection.baseUrl).origin) resolve(response.data)
          else reject(new UploadFailure(uploadError(xhr.status, response?.error?.code), !permanentVerdict(xhr.status, response?.error?.code)))
        } catch { reject(new Error(t('error.instanceBadResponse'))) }
      }
      xhr.onerror = () => reject(new Error(t('error.uploadInterrupted')))
      xhr.ontimeout = () => reject(new Error(t('error.uploadInterrupted')))
      xhr.onabort = () => reject(new Error(lost ? t('error.uploadInterrupted') : t('error.cancelled')))
      xhr.send(form)
    })
    readerUrl(claimed.connection, uploaded)
    if (!await renewLease(id, lease)) throw new Error(t('error.uploadInterrupted'))
    await completeJob(id, lease, uploaded)
  } catch (error) {
    await failJob(id, lease, signal.aborted ? t('error.cancelled') : errorText(error), !(error instanceof UploadFailure) || error.retryable)
  } finally {
    clearInterval(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
