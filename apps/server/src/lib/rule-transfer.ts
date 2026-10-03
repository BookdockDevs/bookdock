import type { Context } from 'hono'

import { RULE_TRANSFER_MAX_BYTES } from '@bookdock/shared'

import { AppError } from '../middleware/error'

export async function readRuleTransferFile(c: Context): Promise<unknown> {
  const reader = c.req.raw.body?.getReader()
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Import file is empty')
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > RULE_TRANSFER_MAX_BYTES) {
        await reader.cancel()
        throw new AppError('UPLOAD_TOO_LARGE', 'Import file is too large')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Import file is not valid JSON')
  }
}
