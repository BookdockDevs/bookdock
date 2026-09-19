import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'

import { legadoAccessKeySchema, legadoExploreSchema, legadoSearchSchema, PAGINATION, type LegadoAccessKeyCreateRes, type LegadoAccessKeyInfo, type LegadoBookInfoRes, type LegadoChapterContentRes, type LegadoChapterItem, type LegadoExploreConfigRes, type LegadoSearchRes, type LegadoTocRes } from '@bookdock/shared'

import { bufferFromStream, getActiveBook, getBookCover, getBookMembership, listBooks } from './books.service'
import { getOrCreateLegadoAccessKey, resolveLegadoAccessKey, rotateLegadoAccessKey } from './legado-access.service'
import { getLegadoBookResource, getLegadoChapterContent, getLegadoExploreConfig, getLegadoExploreFilter, getLegadoToc, type LegadoExploreScope } from './legado.service'
import { AppError } from '../../middleware/error'
import { isLegadoAccessKeyEnabled, isLegadoEnabled, isLegadoEpubMediaEnabled } from '../settings/settings.service'
import { getStorage } from '../../storage'

const legadoRoutes = new Hono()
// Legado uses this value to decide whether a same-URL source import contains newer rules.
const LEGADO_SOURCE_UPDATED_AT = 1789776005000
const LEGADO_SESSION_MAX_AGE = 7 * 24 * 60 * 60

function absoluteUrl(c: Context, path: string): string {
  return new URL(path, c.req.url).toString()
}

function coverUrl(c: Context, bookId: string, coverKey: string | null | undefined): string | null {
  if (!coverKey) return null
  const token = c.get('legadoToken')
  const path = `/api/v1/legado/books/${bookId}/cover`
  return absoluteUrl(c, token ? `${path}?key=${encodeURIComponent(token)}` : path)
}

function bookDescription(meta: Record<string, unknown>): string {
  const bookmeta = meta.bookmeta
  if (!bookmeta || typeof bookmeta !== 'object' || Array.isArray(bookmeta)) return ''
  const description = (bookmeta as { description?: unknown }).description
  return typeof description === 'string' ? description : ''
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function introHtmlText(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br>')
}

function introHtmlParagraph(value: string): string {
  return `<div>　　${introHtmlText(value)}</div>`
}

function formatBookSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatBookDate(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLegadoWordCount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const count = Math.trunc(value)
  if (count > 10000) {
    const wanCount = (count / 10000).toFixed(1).replace(/\.0$/, '')
    return `${wanCount}万字`
  }
  return `${count}字`
}

function legadoBadgeText(value: string): string {
  return value.replace(/[，,\r\n]+/g, ' ').trim()
}

function bookKind(book: Awaited<ReturnType<typeof getActiveBook>>, membership: ReturnType<typeof getBookMembership>): string {
  return [
    book.format,
    membership.shelfName ?? '',
    ...membership.tags,
  ].map(legadoBadgeText).filter(Boolean).join('\n')
}

function bookIntro(book: Awaited<ReturnType<typeof getActiveBook>>): string {
  const metadata = book.meta.bookmeta && typeof book.meta.bookmeta === 'object'
    ? book.meta.bookmeta as Record<string, unknown>
    : {}
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  const subjects = Array.isArray(metadata.subjects)
    ? metadata.subjects.filter((subject): subject is string => typeof subject === 'string' && subject.trim().length > 0)
    : []
  const originalFile = typeof book.meta.fileName === 'string' ? book.meta.fileName.trim() : ''
  const addedAt = formatBookDate(book.createdAt)
  const updatedAt = book.updatedAt !== book.createdAt ? formatBookDate(book.updatedAt) : ''
  const lines: string[] = []
  if (description) {
    const paragraphs = description.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
    lines.push('<div>内容简介：</div>')
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) lines.push('<div><br></div>')
      lines.push(introHtmlParagraph(paragraph))
    })
  }

  const info = [
    ['出版社', typeof metadata.publisher === 'string' ? metadata.publisher : ''],
    ['出版时间', typeof metadata.published === 'string' ? metadata.published : ''],
    ['语言', typeof metadata.language === 'string' ? metadata.language : Array.isArray(metadata.languages) ? metadata.languages.filter((value): value is string => typeof value === 'string').join(', ') : ''],
    ['文件大小', formatBookSize(book.size)],
    ['原始文件', originalFile],
    ['添加时间', addedAt],
    ['最后更新', updatedAt],
    ['ISBN', typeof metadata.isbn === 'string' ? metadata.isbn : typeof metadata.identifier === 'string' ? metadata.identifier : ''],
    ['主题', subjects.join('、')],
    ['系列', typeof metadata.series === 'string' ? metadata.series : ''],
    ['来源', typeof metadata.source === 'string' ? metadata.source : ''],
  ].filter(([, value]) => value)

  if (info.length > 0) {
    if (description) lines.push('<div><br></div>')
    lines.push('<div>书籍信息：</div>', ...info.map(([label, value]) => `<div>　　${escapeHtml(label)}：${introHtmlText(value)}</div>`))
  }
  return `<usehtml>${lines.join('')}</usehtml>`
}

const legadoExploreJsLib = `
    function bdBridge(ctx) {
      if (ctx && ctx.java) return ctx.java;
      if (typeof java !== "undefined" && java) return java;
      return null;
    }

function bdSource(ctx) {
  if (ctx && ctx.source) return ctx.source;
  if (typeof source !== "undefined") return source;
  return null;
}

function bdApiRoot(ctx) {
      if (typeof BD_API_ROOT !== "undefined" && BD_API_ROOT) return String(BD_API_ROOT);
      var holder = bdSource(ctx);
      if (holder && holder.getKey) return String(holder.getKey()) + "/api/v1/legado";
      throw new Error("Bookdock API root is unavailable");
    }

function bdAjax(ctx, url) {
  var bridge = bdBridge(ctx);
  if (!bridge) throw new Error("Legado java.ajax is unavailable");
  var body = bridge.ajax(url);
  if (body === null || body === undefined || String(body).trim() === "") {
    throw new Error("Bookdock returned an empty response");
  }
  return String(body);
}

function bdExploreError(error) {
  var message = String(error && error.message ? error.message : error || "unknown error");
  if (/401|unauthorized|not authenticated|登录/i.test(message)) return "登录状态未传递";
  if (/ajax is unavailable/i.test(message)) return "当前阅读版本不支持发现脚本";
  if (/json|parse/i.test(message)) return "接口返回不是有效数据";
  return "接口请求失败";
}

function bdExploreState(ctx) {
  var holder = bdSource(ctx);
  var state = {};
  try { state = holder ? JSON.parse(holder.getVariable() || "{}") : {}; } catch (error) { state = {}; }
  if (!state || typeof state !== "object") state = {};
  if (["updated", "added", "title"].indexOf(String(state.bdSortField)) < 0) state.bdSortField = "updated";
  if (["asc", "desc"].indexOf(String(state.bdSortOrder)) < 0) state.bdSortOrder = state.bdSortField === "title" ? "asc" : "desc";
  return state;
}

function bdExploreSortFieldLabel(value) {
  if (String(value) === "added") return "添加时间";
  if (String(value) === "title") return "书名";
  return "更新时间";
}

function bdExploreSortFieldValue(label) {
  var value = String(label);
  if (value === "added" || value === "添加时间") return "added";
  if (value === "title" || value === "书名") return "title";
  return "updated";
}

function bdExploreSortOrderLabel(value) {
  return String(value) === "asc" ? "升序" : "降序";
}

function bdExploreSortOrderValue(value) {
  return String(value) === "asc" || String(value) === "升序" ? "asc" : "desc";
}

function bdExploreHeader(rows, title) {
  rows.push({ title: "—— " + title + " ——", url: "", style: { layout_flexGrow: 1, layout_flexBasisPercent: 1 } });
}

function bdExploreEntry(rows, title, url, basis) {
  var type = arguments.length > 4 ? arguments[4] : null;
  var action = arguments.length > 5 ? arguments[5] : null;
  var row = { title: title, url: url, style: { layout_flexGrow: 1, layout_flexBasisPercent: basis === undefined ? 0.3 : basis } };
  if (type) row.type = type;
  if (action) row.action = action;
  rows.push(row);
}

function bdExploreSelectAction(key, title, converter) {
  return "var v=infoMap[" + JSON.stringify(title) + "]||(infoMap.get&&infoMap.get(" + JSON.stringify(title) + "));var d={};try{d=JSON.parse(source.getVariable()||'{}')}catch(e){};d." + key + "=" + converter + "(String(v||''));source.setVariable(JSON.stringify(d));try{source.refreshExplore()}catch(e){}try{java.refreshExplore()}catch(e){}";
}

function bdExploreSelect(rows, state) {
  rows.push({
    title: "排序",
    url: "",
    type: "select",
    chars: ["书名", "添加时间", "更新时间"],
    default: bdExploreSortFieldLabel(state.bdSortField),
    action: bdExploreSelectAction("bdSortField", "排序", "bdExploreSortFieldValue"),
    viewName: "'排序'",
    style: { layout_flexGrow: 1, layout_flexBasisPercent: 0.45 },
  });
  rows.push({
    title: "顺序",
    url: "",
    type: "select",
    chars: ["升序", "降序"],
    default: bdExploreSortOrderLabel(state.bdSortOrder),
    action: bdExploreSelectAction("bdSortOrder", "顺序", "bdExploreSortOrderValue"),
    viewName: "'顺序'",
    style: { layout_flexGrow: 1, layout_flexBasisPercent: 0.45 },
  });
}

function bdExplore(ctx) {
  var state = bdExploreState(ctx);
  var rows = [];
  var config;
  var apiRoot;
  try {
    apiRoot = bdApiRoot(ctx);
    var response = JSON.parse(bdAjax(ctx, apiRoot + "/explore/config"));
    if (response && response.error) {
      throw new Error(String(response.error.message || response.error.code || "request failed"));
    }
    config = response && response.data ? response.data : {};
  } catch (error) {
    bdExploreHeader(rows, "发现加载失败：" + bdExploreError(error));
    return JSON.stringify(rows);
  }

  bdExploreSelect(rows, state);
  var sort = bdExploreSortFieldValue(state.bdSortField);
  var order = bdExploreSortOrderValue(state.bdSortOrder);
  bdExploreEntry(rows, "全部书籍", apiRoot + "/explore/all?page={{page}}&sort=" + sort + "&order=" + order, 1);

  bdExploreHeader(rows, "书架");
  var shelves = config.shelves || [];
  if (!shelves.length) {
    bdExploreEntry(rows, "暂无书架", "", 1);
  } else {
    for (var shelfIndex = 0; shelfIndex < shelves.length; shelfIndex++) {
      var shelf = shelves[shelfIndex] || {};
      bdExploreEntry(rows, String(shelf.name || "未命名书架"), apiRoot + "/explore/shelves/" + encodeURIComponent(String(shelf.id || "")) + "?page={{page}}&sort=" + sort + "&order=" + order);
    }
  }

  bdExploreHeader(rows, "标签");
  var tags = config.tags || [];
  if (!tags.length) {
    bdExploreEntry(rows, "暂无标签", "", 1);
  } else {
    for (var tagIndex = 0; tagIndex < tags.length; tagIndex++) {
      var tag = tags[tagIndex] || {};
      bdExploreEntry(rows, String(tag.name || "未命名标签"), apiRoot + "/explore/tags/" + encodeURIComponent(String(tag.id || "")) + "?page={{page}}&sort=" + sort + "&order=" + order);
    }
  }
  return JSON.stringify(rows);
}
`

function sourceDefinition(c: Context, access?: { id: string; token: string; createdAt?: number }) {
  const origin = new URL(c.req.url).origin
  const apiBase = `${origin}/api/v1/legado`
  const sourceIdentity = access ? `${apiBase}/source/${access.id}` : origin
  return [{
    bookSourceUrl: sourceIdentity,
    bookSourceName: '书坞',
    bookSourceGroup: '书坞',
    bookSourceComment: access ? '只读取当前书坞账户可见的书籍；此书源使用免登录访问密钥。' : '只读取当前书坞账户可见的书籍；导入后请通过登录地址登录。',
    lastUpdateTime: Math.max(LEGADO_SOURCE_UPDATED_AT, access?.createdAt ?? 0),
    enabled: true,
    enabledCookieJar: !access,
    header: access
      ? JSON.stringify({ Authorization: `Bearer ${access.token}` })
      : '@js:\nvar cookieHeader = java.getCookie(baseUrl);\nresult = cookieHeader ? JSON.stringify({"Cookie": cookieHeader}) : "{}";',
    loginUrl: access ? '' : `${apiBase}/login`,
    enabledExplore: true,
    exploreUrl: `@js:\n/* Bookdock explore ${LEGADO_SOURCE_UPDATED_AT} */\nresult = bdExplore(this);`,
    jsLib: `var BD_API_ROOT = ${JSON.stringify(apiBase)};${legadoExploreJsLib}`,
    searchUrl: `${apiBase}/search?keyword={{key}}&page={{page}}`,
    ruleSearch: {
      bookList: '$.data.items[*]',
      name: '$.title',
      author: '$.author',
      kind: '$.kind',
      wordCount: '$.wordCount',
      lastChapter: '$.latestChapterTitle',
      intro: '$.intro',
      bookUrl: '$.url',
      coverUrl: '$.coverUrl',
    },
    ruleBookInfo: {
      name: '$.data.title',
      author: '$.data.author',
      kind: '$.data.kind',
      wordCount: '$.data.wordCount',
      intro: '$.data.intro',
      coverUrl: '$.data.coverUrl',
      tocUrl: '$.data.tocUrl',
    },
    ruleToc: {
      chapterList: '$.data.chapters[*]',
      chapterName: '$.title',
      chapterUrl: '$.url',
      isVolume: '$.isVolume',
    },
    ruleContent: {
      content: '$.data.content',
    },
    ruleExplore: {
      bookList: '$.data.items[*]',
      name: '$.title',
      author: '$.author',
      kind: '$.kind',
      wordCount: '$.wordCount',
      lastChapter: '$.latestChapterTitle',
      intro: '$.intro',
      bookUrl: '$.url',
      coverUrl: '$.coverUrl',
    },
  }]
}

legadoRoutes.use('*', async (c, next) => {
  if (c.req.path.endsWith('/source.json') || c.req.path.endsWith('/login')) {
    return next()
  }
  const user = c.get('user')
  if (c.get('legadoAccessKey') && c.req.path.endsWith('/access-key')) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Legado access keys require the Bookdock session' } }, 403)
  }
  if (user && !isLegadoEnabled(user.id)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Legado book source is disabled' } }, 403)
  }
  return next()
})

legadoRoutes.get('/access-key', (c) => {
  const user = c.get('user')
  const issued = getOrCreateLegadoAccessKey(user.id)
  const sourceUrl = new URL('/api/v1/legado/source.json', c.req.url)
  sourceUrl.searchParams.set('key', issued.token)
  const sourceUrlString = sourceUrl.toString()
  const data: LegadoAccessKeyInfo = {
    active: true,
    createdAt: issued.createdAt,
    expiresAt: issued.expiresAt,
    sourceUrl: sourceUrlString,
    importUrl: `legado://import/bookSource?src=${encodeURIComponent(sourceUrlString)}`,
  }
  return c.json({ data })
})

legadoRoutes.post('/access-key', async (c) => {
  const parsed = legadoAccessKeySchema.safeParse(await c.req.json().catch(() => ({})))
  const duration = parsed.success ? parsed.data.duration : 'permanent'
  const user = c.get('user')
  const issued = rotateLegadoAccessKey(user.id, duration)
  const sourceUrl = new URL('/api/v1/legado/source.json', c.req.url)
  sourceUrl.searchParams.set('key', issued.token)
  const sourceUrlString = sourceUrl.toString()
  const data: LegadoAccessKeyCreateRes = {
    sourceUrl: sourceUrlString,
    importUrl: `legado://import/bookSource?src=${encodeURIComponent(sourceUrlString)}`,
    createdAt: issued.createdAt,
    expiresAt: issued.expiresAt,
  }
  return c.json({ data })
})

legadoRoutes.get('/source.json', (c) => {
  const token = c.req.query('key')
  if (!token) return c.json(sourceDefinition(c))
  const access = resolveLegadoAccessKey(token)
  if (!access) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired Legado access key' } }, 401)
  if (!isLegadoEnabled(access.userId)) return c.json({ error: { code: 'FORBIDDEN', message: 'Legado book source is disabled' } }, 403)
  if (!isLegadoAccessKeyEnabled(access.userId)) return c.json({ error: { code: 'FORBIDDEN', message: 'Legado access keys are disabled' } }, 403)
  return c.json(sourceDefinition(c, { id: access.id, token, createdAt: access.createdAt }))
})

legadoRoutes.get('/login', (c) => {
  const token = getCookie(c, 'bd_token')
  if (token) {
    setCookie(c, 'bd_token', token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: LEGADO_SESSION_MAX_AGE,
    })
  }
  return c.redirect(new URL('/login?legado=1', c.req.url).toString())
})

async function exploreBooks(c: Context, scope: LegadoExploreScope, id?: string) {
  const parsed = legadoExploreSchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Legado explore query', details: parsed.error.flatten() } }, 400)
  }

  const user = c.get('user')
  const filter = getLegadoExploreFilter(user.id, scope, id)
  const sortBy = parsed.data.sort === 'updated' ? 'updatedAt' : parsed.data.sort === 'title' ? 'title' : 'createdAt'
  const sortOrder = parsed.data.order ?? (parsed.data.sort === 'title' ? 'asc' : 'desc')
  const result = await listBooks(
    user.id,
    parsed.data.page,
    PAGINATION.DEFAULT_PAGE_SIZE,
    undefined,
    sortBy,
    sortOrder,
    filter.shelfId,
    filter.tagId,
  )
  const items = await Promise.all(result.data.map(async (book) => {
    const detail = await getActiveBook(user.id, book.id)
    const chapters = await getLegadoToc(user.id, book.id)
    const latestChapter = [...chapters].reverse().find((chapter) => !chapter.isVolume)
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      kind: bookKind(detail, { shelfName: book.shelfName, tags: book.tags }),
      wordCount: formatLegadoWordCount(detail.meta.wordCount),
      latestChapterTitle: latestChapter?.title ?? null,
      intro: bookDescription(detail.meta),
      url: absoluteUrl(c, `/api/v1/legado/books/${book.id}`),
      coverUrl: coverUrl(c, book.id, book.coverKey),
    }
  }))

  return c.json({
    data: {
      items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    } satisfies LegadoSearchRes,
  })
}

legadoRoutes.get('/explore/config', (c) => {
  const user = c.get('user')
  const data = getLegadoExploreConfig(user.id)
  return c.json({ data } satisfies { data: LegadoExploreConfigRes })
})

legadoRoutes.get('/explore/all', (c) => exploreBooks(c, 'all'))
legadoRoutes.get('/explore/shelves/:id', (c) => exploreBooks(c, 'shelf', c.req.param('id')))
legadoRoutes.get('/explore/tags/:id', (c) => exploreBooks(c, 'tag', c.req.param('id')))

legadoRoutes.get('/search', async (c) => {
  const parsed = legadoSearchSchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Legado search query', details: parsed.error.flatten() } }, 400)
  }

  const user = c.get('user')
  const result = await listBooks(user.id, parsed.data.page, PAGINATION.DEFAULT_PAGE_SIZE, parsed.data.keyword || undefined)
  const items = await Promise.all(result.data.map(async (book) => {
    const detail = await getActiveBook(user.id, book.id)
    const chapters = await getLegadoToc(user.id, book.id)
    const latestChapter = [...chapters].reverse().find((chapter) => !chapter.isVolume)
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      kind: bookKind(detail, { shelfName: book.shelfName, tags: book.tags }),
      wordCount: formatLegadoWordCount(detail.meta.wordCount),
      latestChapterTitle: latestChapter?.title ?? null,
      intro: bookDescription(detail.meta),
      url: absoluteUrl(c, `/api/v1/legado/books/${book.id}`),
      coverUrl: coverUrl(c, book.id, book.coverKey),
    }
  }))

  return c.json({
    data: {
      items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    } satisfies LegadoSearchRes,
  })
})

legadoRoutes.get('/books/:id', async (c) => {
  const user = c.get('user')
  const book = await getActiveBook(user.id, c.req.param('id'))
  const membership = getBookMembership(user.id, book.id, book.shelfId)
  const wordCount = typeof book.meta.wordCount === 'number' && Number.isFinite(book.meta.wordCount) ? book.meta.wordCount : null
  const data: LegadoBookInfoRes = {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    kind: bookKind(book, membership),
    description: bookDescription(book.meta),
    intro: bookIntro(book),
    wordCount,
    coverUrl: coverUrl(c, book.id, book.coverKey),
    tocUrl: absoluteUrl(c, `/api/v1/legado/books/${book.id}/chapters`),
  }
  return c.json({ data })
})

legadoRoutes.get('/books/:id/cover', async (c) => {
  const user = c.get('user')
  const cover = await getBookCover(user.id, c.req.param('id'))
  if (!cover) return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'No cover' } }, 404)
  const storage = getStorage()
  if (!(await storage.exists(cover.coverKey))) return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'Cover file missing' } }, 404)
  const body = new Uint8Array(await bufferFromStream(await storage.get(cover.coverKey)))
  const ext = cover.coverKey.split('.').pop()?.toLowerCase()
  const contentType = ext === 'png'
    ? 'image/png'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'svg'
          ? 'image/svg+xml'
          : 'image/jpeg'
  return c.newResponse(body, 200, { 'Content-Type': contentType, 'Cache-Control': 'private, immutable, max-age=31536000' })
})

legadoRoutes.get('/books/:id/resource', async (c) => {
  const resourcePath = c.req.query('path')
  if (!resourcePath) throw new AppError('VALIDATION_ERROR', 'EPUB resource path is required')
  const user = c.get('user')
  const resource = await getLegadoBookResource(user.id, c.req.param('id'), resourcePath)
  return c.newResponse(new Uint8Array(resource.data), 200, {
    'Content-Type': resource.mediaType,
    'Content-Length': String(resource.data.length),
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, immutable, max-age=31536000',
  })
})

legadoRoutes.get('/books/:id/chapters', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const chapters = await getLegadoToc(user.id, bookId)
  const data: LegadoTocRes = {
    chapters: chapters.map((chapter): LegadoChapterItem => ({
      id: chapter.id,
      index: chapter.index,
      title: chapter.title,
      level: chapter.level,
      isVolume: chapter.isVolume,
      url: chapter.isVolume
        ? `${chapter.title}${chapter.index}`
        : absoluteUrl(c, `/api/v1/legado/books/${bookId}/chapters/${chapter.index}`),
    })),
  }
  return c.json({ data })
})

legadoRoutes.get('/books/:id/chapters/:index', async (c) => {
  const index = Number(c.req.param('index'))

  const user = c.get('user')
  const bookId = c.req.param('id')
  const token = c.get('legadoToken')
  const includeMedia = isLegadoEpubMediaEnabled(user.id)
  const chapter = await getLegadoChapterContent(
    user.id,
    bookId,
    index,
    (resourcePath) => {
      const base = `/api/v1/legado/books/${bookId}/resource?path=${encodeURIComponent(resourcePath)}`
      return absoluteUrl(c, token ? `${base}&key=${encodeURIComponent(token)}` : base)
    },
    includeMedia,
  )
  const data: LegadoChapterContentRes = {
    id: chapter.id,
    index: chapter.index,
    title: chapter.title,
    content: chapter.content,
  }
  return c.json({ data })
})

export default legadoRoutes
