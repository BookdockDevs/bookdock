import { Hono } from 'hono'

import { bookShareGenerateRequestSchema, bookShareSourceSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { safeFileBase, streamBookFile } from './book-file-response'
import { manageBookShare, resolveBookShare } from './book-shares.service'
import { exportPlainTxtFile } from './txt-export'

const bookShareRoutes = new Hono()

bookShareRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Referrer-Policy', 'no-referrer')
  await next()
})

bookShareRoutes.get('/books/:versionId', (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const query = bookShareSourceSchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR', 'Invalid share source', query.error.flatten())
  return c.json({ data: manageBookShare(user.id, c.req.param('versionId'), query.data.libraryId, { type: 'read' }) })
})

bookShareRoutes.post('/books/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const input: unknown = await c.req.json().catch(() => null)
  const body = bookShareGenerateRequestSchema.safeParse(input)
  if (!body.success) throw new AppError('VALIDATION_ERROR', 'Invalid download link options', body.error.flatten())
  const { libraryId, duration, replace } = body.data
  return c.json({ data: manageBookShare(user.id, c.req.param('versionId'), libraryId, { type: replace ? 'generate' : 'get-or-create', duration }) })
})

bookShareRoutes.delete('/books/:versionId', (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const query = bookShareSourceSchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR', 'Invalid share source', query.error.flatten())
  return c.json({ data: manageBookShare(user.id, c.req.param('versionId'), query.data.libraryId, { type: 'revoke' }) })
})

function unavailableSharePage(acceptLanguage: string | undefined): string {
  const isZh = acceptLanguage?.toLowerCase().includes('zh') ?? false
  const lang = isZh ? 'zh-CN' : 'en'
  const title = isZh ? '链接已失效' : 'Link unavailable'
  const description = isZh
    ? '该下载链接已过期或被撤销，请联系分享者重新获取。'
    : 'This download link has expired or been revoked. Ask the sender for a new link.'

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fafaf9;
      color: #1c1917;
    }
    main {
      width: 100%;
      max-width: 400px;
      padding: 32px 28px;
      border-radius: 16px;
      background: #ffffff;
      border: 1px solid #e7e5e4;
      box-shadow: 0 8px 24px rgba(28, 25, 23, 0.06);
      text-align: center;
    }
    .icon {
      width: 44px;
      height: 44px;
      margin: 0 auto 16px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      background: #f5f5f4;
      color: #78716c;
    }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #57534e; }
    @media (prefers-color-scheme: dark) {
      body { background: #0c0a09; color: #f5f5f4; }
      main { background: #1c1917; border-color: #292524; box-shadow: none; }
      .icon { background: #292524; color: #a8a29e; }
      p { color: #a8a29e; }
    }
  </style>
</head>
<body>
  <main>
    <div class="icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
        <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
        <line x1="8" y1="2" x2="8" y2="5" />
        <line x1="2" y1="8" x2="5" y2="8" />
        <line x1="16" y1="19" x2="16" y2="22" />
        <line x1="19" y1="16" x2="22" y2="16" />
      </svg>
    </div>
    <h1>${title}</h1>
    <p>${description}</p>
  </main>
</body>
</html>`
}

bookShareRoutes.get('/download/:token', async (c) => {
  const token = c.req.param('token')
  const book = /^bd_sh_[A-Za-z0-9_-]{43}$/.test(token) ? resolveBookShare(token) : null
  if (!book) {
    if (c.req.header('accept')?.includes('text/html')) {
      return c.html(unavailableSharePage(c.req.header('accept-language')), 404)
    }
    throw new AppError('BOOK_NOT_FOUND', 'This download link is no longer available')
  }
  if (book.format === 'epub') return streamBookFile(c, book)
  const text = await exportPlainTxtFile(book.filePath)
  const filename = `${safeFileBase(book.title)}.txt`
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  return c.text(text)
})

export default bookShareRoutes
