import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context, MiddlewareHandler } from 'hono'
import type { z } from 'zod'
import type { ZodType } from 'zod'

import {
  importTargetBookReqSchema,
  readingImportApplyReqSchema,
  readingImportScopeSchema,
  wereadBookListReqSchema,
  wereadPreviewReqSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { getWeReadKey } from '../integrations/weread.service'
import { applyImport, applyWereadImport, buildPreview, scopeProposal, selectProposalBooks, wereadDatasetKey, type ImportProposal } from './reading-imports.service'
import { readImportPreview, saveImportPreview } from './preview-store'
import { parseLegadoBackup } from './legado-import'
import { fetchWereadBookList, fetchWereadProposal } from './weread-import'
import { fetchWereadWebBookList, fetchWereadWebProposal, wereadWebDatasetKey } from './weread-web-import'
import { buildLocatorReport } from './locator-report'
import { mountArchive } from './mount-archive'
import {
  clearWereadWebSession,
  cancelWereadQrLogin,
  getWereadQrLoginStatus,
  getWereadWebSessionStatus,
  refreshWereadWebCredential,
  startWereadQrLogin,
  getWereadWebCredential,
  verifyWereadWebSession,
} from './weread-durations'

const readingImportsRoutes = new Hono()

readingImportsRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return next()
})

/** Proxy cover images that require header stripping (e.g. WeRead custom epub covers
 * returning Content-Disposition: attachment from Tencent Cloud COS). */
readingImportsRoutes.get('/cover-proxy', async (c) => {
  const urlParam = c.req.query('url')
  if (!urlParam) throw new AppError('VALIDATION_ERROR', 'URL is required')

  let targetUrl: URL
  try {
    targetUrl = new URL(urlParam)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid URL')
  }

  const allowedHost =
    targetUrl.protocol === 'https:' &&
    (targetUrl.hostname.endsWith('.weread.qq.com') ||
      targetUrl.hostname.endsWith('.myqcloud.com') ||
      targetUrl.hostname.endsWith('.qqmail.com') ||
      targetUrl.hostname.endsWith('.tencent-cloud.com'))

  if (!allowedHost) throw new AppError('VALIDATION_ERROR', 'Unsupported host for cover proxy')

  try {
    const res = await fetch(targetUrl.href, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!res.ok) throw new AppError('VALIDATION_ERROR', 'Cover fetch failed')

    const buffer = Buffer.from(await res.arrayBuffer())

    let contentType = 'image/jpeg'
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      contentType = 'image/png'
    } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      contentType = 'image/jpeg'
    } else if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      contentType = 'image/webp'
    }

    return c.body(buffer, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    })
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Failed to proxy cover image')
  }
})

function readScope(value: unknown): 'all' | 'time' | 'notes' {
  const parsed = readingImportScopeSchema.safeParse(value ?? 'all')
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid scope')
  return parsed.data
}

async function readZipBody(c: Context): Promise<Buffer> {
  const maxBytes = effectiveUploadMaxBytes()
  // Reject oversized uploads before buffering the multipart body.
  const declared = Number(c.req.header('content-length') ?? '0')
  if (declared > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'Backup file too large')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'Backup file required')
  if (file.size > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'Backup file too large')
  return Buffer.from(await file.arrayBuffer())
}

// The Content-Length check above cannot see a chunked upload that omits the
// header, and parseBody would buffer the whole stream before the file-size
// check. bodyLimit counts the actual bytes and aborts mid-stream; maxSize is
// resolved per request because instance settings are runtime-editable.
const limitZipUpload: MiddlewareHandler = (c, next) => bodyLimit({
  maxSize: effectiveUploadMaxBytes(),
  onError: () => { throw new AppError('UPLOAD_TOO_LARGE', 'Backup file too large') },
})(c, next)

async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON body')
  }
}

function parseBody<S extends ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid request', parsed.error.issues)
  return parsed.data
}

/** The skill channel only ever imports everything: it has no per-book duration
 * and its entry is all-only, so any other scope is a caller mistake rather than
 * a request to silently widen. */
function assertWereadChannelScope(channel: 'skill' | 'web', scope: 'all' | 'time' | 'notes'): void {
  if (channel === 'skill' && scope !== 'all') {
    throw new AppError('VALIDATION_ERROR', 'The WeRead skill channel only supports the all scope; use the web channel for time or notes')
  }
}

type WereadChannel = 'skill' | 'web'

async function runWeread(userId: string, channel: WereadChannel, scope: 'all' | 'time' | 'notes', bookKeys: string[] | null): Promise<{ datasetKey: string; proposal: ImportProposal }> {
  if (channel === 'web') {
    const credential = getWereadWebCredential(userId)
    if (!credential) throw new AppError('WEREAD_WEB_NOT_CONFIGURED', 'WeRead web login is not configured')
    return {
      datasetKey: wereadWebDatasetKey(credential.vid),
      proposal: await fetchWereadWebProposal(credential, scope, bookKeys, (next) => refreshWereadWebCredential(userId, next)),
    }
  }
  const key = getWeReadKey(userId)
  if (!key) throw new AppError('VALIDATION_ERROR', 'WeRead API key is not configured')
  // The raw proposal is what the preview snapshot stores: scope filtering and
  // the ticked-book selection are applied when the snapshot is consumed. Only
  // the ticked books are fetched, so a preview costs one round trip per chosen
  // book instead of one per book in the account.
  const proposal = await fetchWereadProposal(key, scope, bookKeys)
  return { datasetKey: wereadDatasetKey(key), proposal }
}

/** The book list is loaded only on request; per-book records are fetched only
 * after the reader selects books and asks for a preview. */
readingImportsRoutes.post('/weread/books', async (c) => {
  const userId = c.get('user')!.id
  const { channel, scope } = parseBody(wereadBookListReqSchema, await readJsonBody(c))
  assertWereadChannelScope(channel, scope)
  if (channel === 'web') {
    const credential = getWereadWebCredential(userId)
    if (!credential) throw new AppError('WEREAD_WEB_NOT_CONFIGURED', 'WeRead web login is not configured')
    const proposal = await fetchWereadWebBookList(credential, scope, (next) => refreshWereadWebCredential(userId, next))
    return c.json({ data: buildPreview(userId, 'weread', wereadWebDatasetKey(credential.vid), proposal, scope) })
  }
  const key = getWeReadKey(userId)
  if (!key) throw new AppError('VALIDATION_ERROR', 'WeRead API key is not configured')
  const proposal = await fetchWereadBookList(key, scope)
  return c.json({ data: buildPreview(userId, 'weread', wereadDatasetKey(key), proposal, scope) })
})

readingImportsRoutes.post('/weread/preview', async (c) => {
  const userId = c.get('user')!.id
  const { channel, scope, bookKeys } = parseBody(wereadPreviewReqSchema, await readJsonBody(c))
  assertWereadChannelScope(channel, scope)
  const { datasetKey, proposal } = await runWeread(userId, channel, scope, bookKeys ?? null)
  const id = saveImportPreview({ userId, source: 'weread', datasetKey, proposal, scope })
  return c.json({ data: { ...buildPreview(userId, 'weread', datasetKey, proposal, scope), previewId: id } })
})

readingImportsRoutes.post('/weread/import', async (c) => {
  const userId = c.get('user')!.id
  const { previewId: id, bookKeys, overwrite } = parseBody(readingImportApplyReqSchema, await readJsonBody(c))
  const snapshot = readImportPreview(id, userId)
  if (snapshot.source !== 'weread') throw new AppError('VALIDATION_ERROR', 'Import preview source mismatch')
  const { datasetKey, proposal, scope } = snapshot
  return c.json({ data: await applyWereadImport(userId, datasetKey, selectProposalBooks(scopeProposal(proposal, scope), bookKeys ?? null), scope, new Set(overwrite ?? [])) })
})

readingImportsRoutes.post('/legado/preview', limitZipUpload, async (c) => {
  const userId = c.get('user')!.id
  const scope = readScope(c.req.query('scope'))
  const buffer = await readZipBody(c)
  const proposal = await parseLegadoBackup(buffer)
  const id = saveImportPreview({ userId, source: 'legado', datasetKey: '', proposal, scope })
  return c.json({ data: { ...buildPreview(userId, 'legado', '', proposal, scope), previewId: id } })
})

readingImportsRoutes.post('/legado/import', async (c) => {
  const userId = c.get('user')!.id
  const { previewId: id, bookKeys, overwrite } = parseBody(readingImportApplyReqSchema, await readJsonBody(c))
  const snapshot = readImportPreview(id, userId)
  if (snapshot.source !== 'legado') throw new AppError('VALIDATION_ERROR', 'Import preview source mismatch')
  const { datasetKey, proposal, scope } = snapshot
  return c.json({ data: await applyImport(userId, 'legado', datasetKey, selectProposalBooks(scopeProposal(proposal, scope), bookKeys ?? null), scope, new Set(overwrite ?? [])) })
})

readingImportsRoutes.post('/archives/:id/locator-report', async (c) => {
  const userId = c.get('user')!.id
  const { targetBookVersionId: target } = parseBody(importTargetBookReqSchema, await readJsonBody(c))
  return c.json({ data: await buildLocatorReport(userId, c.req.param('id') ?? '', target) })
})

readingImportsRoutes.post('/archives/:id/mount', async (c) => {
  const userId = c.get('user')!.id
  const { targetBookVersionId: target } = parseBody(importTargetBookReqSchema, await readJsonBody(c))
  return c.json({ data: await mountArchive(userId, c.req.param('id') ?? '', target) })
})

/** Web channel session (第 7 步). A cookie is a whole-account login, so it is
 * stored on its own and never merged with the read-only key settings. */
readingImportsRoutes.post('/weread/web-login', async (c) => {
  return c.json({ data: await startWereadQrLogin(c.get('user')!.id) })
})

readingImportsRoutes.get('/weread/web-login/:id', async (c) => {
  return c.json({ data: getWereadQrLoginStatus(c.get('user')!.id, c.req.param('id') ?? '') })
})

readingImportsRoutes.delete('/weread/web-login/:id', async (c) => {
  cancelWereadQrLogin(c.get('user')!.id, c.req.param('id') ?? '')
  return c.json({ data: { cancelled: true } })
})

readingImportsRoutes.get('/weread/web-session', async (c) => {
  const userId = c.get('user')!.id
  return c.json({ data: getWereadWebSessionStatus(userId) })
})

/** Probes WeRead with the stored cookie so the dialog can tell "connected"
 * from "logged out" at the moment the reader opens the web channel. */
readingImportsRoutes.post('/weread/web-session/verify', async (c) => {
  const userId = c.get('user')!.id
  return c.json({ data: await verifyWereadWebSession(userId) })
})

readingImportsRoutes.delete('/weread/web-session', async (c) => {
  const userId = c.get('user')!.id
  clearWereadWebSession(userId)
  return c.json({ data: getWereadWebSessionStatus(userId) })
})

export default readingImportsRoutes
