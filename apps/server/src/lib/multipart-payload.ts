import type { Context } from 'hono'

import { AppError } from '../middleware/error'

/**
 * Read a "one JSON document plus optional files" request body.
 *
 * The editor save endpoints accept both shapes so the client can always send
 * one request: `application/json` when nothing is being uploaded, multipart
 * (`payload` = the JSON document, everything else = files) when it is. Without
 * that, an edit that happens to include a cover would have to be split back
 * into two calls — which is exactly the fan-out that made these saves
 * impossible to undo as one action.
 */
export async function readJsonOrMultipartPayload(c: Context): Promise<{
  payload: unknown
  files: Record<string, File>
}> {
  const contentType = (c.req.header('content-type') ?? '').toLowerCase()
  if (!contentType.includes('multipart/form-data')) {
    return { payload: await c.req.json().catch(() => null), files: {} }
  }
  const body = await c.req.parseBody()
  const raw = body['payload']
  if (typeof raw !== 'string') throw new AppError('VALIDATION_ERROR', 'payload is required')
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'payload must be JSON')
  }
  const files: Record<string, File> = {}
  for (const [name, value] of Object.entries(body)) {
    if (name === 'payload' || !(value instanceof File)) continue
    files[name] = value
  }
  return { payload, files }
}
