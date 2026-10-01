import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'

import { legadoAccessKeySchema, legadoExploreSchema, legadoSearchSchema, PAGINATION, type LegadoAccessKeyCreateRes, type LegadoAccessKeyInfo, type LegadoBookInfoRes, type LegadoBookSearchItem, type LegadoChapterContentRes, type LegadoChapterItem, type LegadoExploreConfigRes, type LegadoSearchRes, type LegadoTocRes } from '@bookdock/shared'

import { getActiveBook, getBookCoverContent, getBookMembership } from './books.service'
import { getOrCreateLegadoAccessKey, resolveLegadoAccessKey, rotateLegadoAccessKey } from './legado-access.service'
import { getLegadoBookResource, getLegadoChapterContent, getLegadoExploreConfig, getLegadoExploreFilter, getLegadoToc, legadoJoinedLibraryIds, legadoLatestChapterTitles, legadoPrivateLibraryId, LEGADO_READ, type LegadoExploreScope } from './legado.service'
import { getLibraryVersionPublication, listLibraryVersionEntries, type LibraryVersionEntry } from '../libraries/catalog.service'
import { AppError } from '../../middleware/error'
import { getUserTimezone } from '../auth/auth.service'
import { formatTimestamp } from '../../lib/format-timestamp'
import { isLegadoAccessKeyEnabled, isLegadoEnabled, isLegadoEpubMediaEnabled } from '../settings/settings.service'

const legadoRoutes = new Hono()
// Legado uses this value to decide whether a same-URL source import contains
// newer rules, and the same number is embedded in `exploreUrl` because Legado
// caches the generated discovery rows keyed by MD5(bookSourceUrl + exploreUrl).
// Bumping it is what forces an already-imported source to re-run the script.
const LEGADO_SOURCE_UPDATED_AT = 1793731200000
const LEGADO_SESSION_MAX_AGE = 7 * 24 * 60 * 60

function publicOrigin(c: Context): string {
  const requestUrl = new URL(c.req.url)
  // Keep the request host so a forwarded host cannot redirect key-bearing URLs.
  if (requestUrl.protocol === 'http:' && c.req.header('x-forwarded-proto') === 'https') {
    requestUrl.protocol = 'https:'
  }
  return requestUrl.origin
}

function absoluteUrl(c: Context, path: string): string {
  return new URL(path, publicOrigin(c)).toString()
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

function formatBookDate(timestamp: number | null | undefined, timezone: string | null): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return ''
  return formatTimestamp(timestamp, timezone)
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

/**
 * Publication metadata for one version, already merged version over work over
 * parsed file by the library listing. Reading a single flat `meta.bookmeta`
 * here dropped the work- and version-level overrides a shared library curator
 * set, so a curated edition lost its publisher and series on the detail page.
 */
function bookIntro(book: {
  meta: Record<string, unknown>
  size: number
  createdAt: number
  updatedAt: number
}, mergedBookmeta: Record<string, unknown> | undefined, mergedFileName: string | null, timezone: string | null): string {
  const metadata = mergedBookmeta && typeof mergedBookmeta === 'object'
    ? mergedBookmeta
    : book.meta.bookmeta && typeof book.meta.bookmeta === 'object' ? book.meta.bookmeta as Record<string, unknown> : {}
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
  const subjects = Array.isArray(metadata.subjects)
    ? metadata.subjects.filter((subject): subject is string => typeof subject === 'string' && subject.trim().length > 0)
    : []
  const originalFile = (mergedFileName ?? (typeof book.meta.fileName === 'string' ? book.meta.fileName : '')).trim()
  const addedAt = formatBookDate(book.createdAt, timezone)
  const updatedAt = book.updatedAt !== book.createdAt ? formatBookDate(book.updatedAt, timezone) : ''
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
  if (/ajax is unavailable/i.test(message)) return "当前阅读版本不支持发现脚本";
  if (/disabled|not enabled/i.test(message)) return "书源服务已关闭";
  if (/json|parse/i.test(message)) return "接口返回不是有效数据";
  return "接口请求失败";
}

// "Not signed in" arrives in two shapes and neither is a request failure: with
// guest access off the guard answers 401, and with it on the guard injects the
// guest user and the facade refuses that session with FORBIDDEN. A disabled
// integration is also FORBIDDEN, so the code and the message are both needed to
// keep "switch it back on" from being reported as "sign in first".
function bdExploreLoginRequired(error) {
  var code = String(error && error.code ? error.code : "");
  var message = String(error && error.message ? error.message : error || "");
  if (code === "UNAUTHORIZED") return true;
  if (code === "FORBIDDEN") return /guest/i.test(message);
  return /401|unauthorized|not authenticated/i.test(message);
}

function bdExploreLoginRows(rows) {
  bdExploreHeader(rows, "未登录书坞");
  // No clickable shortcut: the login bridge sets its cookie in Legado's own
  // WebView, so opening it in an external browser would never reach the
  // CookieStore this source reads from.
  // Both actions live in the popup that a long press on the source row opens;
  // the discovery list has no swipe-refresh container, so naming a pull-down
  // gesture here would send the reader down a path that does nothing.
  bdExploreEntry(rows, "请长按书源名「书坞」，在弹出菜单中点登录，登录后再次长按点刷新", "", 1);
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

function bdExploreIndent(depth) {
  var n = Number(depth);
  if (!isFinite(n) || n <= 0) return "";
  // Full-width spaces rather than nesting: Legado's discovery list is flat, so
  // a child shelf is marked by indentation inside its parent's section.
  return new Array(Math.min(Math.round(n), 4) + 1).join("　");
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

function bdExploreEmpty(rows, label) {
  bdExploreEntry(rows, label, "", 1);
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
      var failure = new Error(String(response.error.message || response.error.code || "request failed"));
      failure.code = String(response.error.code || "");
      throw failure;
    }
    config = response && response.data ? response.data : {};
  } catch (error) {
    if (bdExploreLoginRequired(error)) {
      bdExploreLoginRows(rows);
    } else {
      bdExploreHeader(rows, "发现加载失败：" + bdExploreError(error));
    }
    return JSON.stringify(rows);
  }

  bdExploreSelect(rows, state);
  var sort = bdExploreSortFieldValue(state.bdSortField);
  var order = bdExploreSortOrderValue(state.bdSortOrder);
  var query = "page={{page}}&sort=" + sort + "&order=" + order;
  var libraries = config.libraries || [];
  // Nothing browsable: say so instead of rendering an all-books link that
  // would open an empty list.
  if (!libraries.length) {
    bdExploreEmpty(rows, "暂无可浏览的书库");
    return JSON.stringify(rows);
  }
  var multiple = libraries.length > 1;

  // A single library keeps the flat "全部书籍" entry the source always had; with
  // more than one, each library gets its own full-width row so the reader can
  // tell the private library from the ones they joined.
  if (!multiple) {
    bdExploreEntry(rows, "全部书籍", apiRoot + "/explore/all?scope=joined&" + query, 1);
  } else {
    for (var libIndex = 0; libIndex < libraries.length; libIndex++) {
      var libRow = libraries[libIndex] || {};
      bdExploreEntry(rows, "全部 · " + String(libRow.name || "书库"), apiRoot + "/explore/libraries/" + encodeURIComponent(String(libRow.id || "")) + "?" + query, 1);
    }
  }

  for (var index = 0; index < libraries.length; index++) {
    var library = libraries[index] || {};
    var libraryId = encodeURIComponent(String(library.id || ""));
    var libraryName = String(library.name || "书库");
    // Section headings name the library only when there is more than one, so a
    // single-library reader sees the familiar 书架 / 标签 headings.
    var prefix = multiple ? libraryName + " · " : "";
    // The reader's own library keeps the 书架 wording the Web sidebar uses; a
    // shared library's taxonomy is 分类.
    var categoryLabel = String(library.type) === "private" ? "书架" : "分类";

    bdExploreHeader(rows, prefix + categoryLabel);
    var categories = library.categories || [];
    if (!categories.length) {
      bdExploreEmpty(rows, categoryLabel === "书架" ? "暂无书架" : "暂无分类");
    } else {
      for (var c = 0; c < categories.length; c++) {
        var category = categories[c] || {};
        bdExploreEntry(rows, bdExploreIndent(category.depth) + String(category.name || (categoryLabel === "书架" ? "未命名书架" : "未命名分类")), apiRoot + "/explore/libraries/" + libraryId + "/categories/" + encodeURIComponent(String(category.id || "")) + "?" + query);
      }
    }

    bdExploreHeader(rows, prefix + "标签");
    var tags = library.tags || [];
    if (!tags.length) {
      bdExploreEmpty(rows, "暂无标签");
    } else {
      for (var t = 0; t < tags.length; t++) {
        var tag = tags[t] || {};
        bdExploreEntry(rows, String(tag.name || "未命名标签"), apiRoot + "/explore/libraries/" + libraryId + "/tags/" + encodeURIComponent(String(tag.id || "")) + "?" + query);
      }
    }
  }
  return JSON.stringify(rows);
}
`

function sourceDefinition(c: Context, access?: { id: string; token: string; createdAt?: number }) {
  const origin = publicOrigin(c)
  const apiBase = `${origin}/api/v1/legado`
  const sourceIdentity = access ? `${apiBase}/source/${access.id}` : origin
  return [{
    bookSourceUrl: sourceIdentity,
    bookSourceName: '书坞',
    bookSourceGroup: '书坞',
    bookSourceComment: access
      ? '只读取当前书坞账户可见的书籍，含我的书库与已加入的共享书库；此书源使用免登录访问密钥。'
      : '只读取当前书坞账户可见的书籍，含我的书库与已加入的共享书库；导入后请通过登录地址登录。',
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
    searchUrl: `${apiBase}/search?keyword={{key}}&page={{page}}&scope=joined`,
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
      updateTime: '$.contentUpdateDate',
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
  if (c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot use Legado integration')
  }
  const user = c.get('user')
  if (c.get('legadoAccessKey') && c.req.path.endsWith('/access-key')) {
    throw new AppError('FORBIDDEN', 'Legado access keys require the Bookdock session')
  }
  if (user && !isLegadoEnabled(user.id)) {
    throw new AppError('FORBIDDEN', 'Legado book source is disabled')
  }
  return next()
})

legadoRoutes.get('/access-key', (c) => {
  const user = c.get('user')
  const issued = getOrCreateLegadoAccessKey(user.id)
  const sourceUrl = new URL('/api/v1/legado/source.json', publicOrigin(c))
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
  const sourceUrl = new URL('/api/v1/legado/source.json', publicOrigin(c))
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
  if (!access) throw new AppError('UNAUTHORIZED', 'Invalid or expired Legado access key')
  if (!isLegadoEnabled(access.userId)) throw new AppError('FORBIDDEN', 'Legado book source is disabled')
  if (!isLegadoAccessKeyEnabled(access.userId)) throw new AppError('FORBIDDEN', 'Legado access keys are disabled')
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
  return c.redirect(absoluteUrl(c, '/login?legado=1'))
})

/**
 * One page of readable versions across the requested libraries, projected into
 * the shape `ruleSearch` and `ruleExplore` read. A work with several versions
 * is one entry per version, because Legado addresses a book by `bookUrl` and
 * that url is a BookVersion: collapsing them would leave the other versions
 * unreachable from the source.
 */
async function legadoSearchItems(
  c: Context,
  userId: string,
  libraryIds: string[],
  params: { page: number; sortBy?: string; sortOrder?: string; categoryId?: string; tagId?: string; search?: string },
) {
  const items: LegadoBookSearchItem[] = []
  let page = params.page
  let total = 0
  // Libraries are paged in turn and merged, so a joined library's books stay
  // reachable without any single library having to fill the page alone.
  for (const libraryId of libraryIds) {
    const result = await listLibraryVersionEntries(userId, libraryId, { ...params, page })
    const latest = legadoLatestChapterTitles(result.items.map((entry) => entry.bookVersionId))
    for (const entry of result.items) items.push(legadoItem(c, entry, latest.get(entry.bookVersionId) ?? null))
    total += result.total
    if (items.length >= PAGINATION.DEFAULT_PAGE_SIZE) break
    page = 1
  }
  return {
    items: items.slice(0, PAGINATION.DEFAULT_PAGE_SIZE),
    page: params.page,
    pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
    total,
  } satisfies LegadoSearchRes
}

/**
 * Badges for one version: format, its category, its tags, and its version
 * label when the uploader named it. The version label is a badge rather than a
 * title suffix so the book keeps the name a reader recognises; Legado's own
 * search does merge same-title hits, and discovery browsing does not, so the
 * labelled versions stay separately reachable through every browse path.
 */
function legadoKind(entry: Pick<LibraryVersionEntry, 'format' | 'categoryName' | 'tags' | 'versionName'>): string {
  return [entry.format, entry.categoryName ?? '', entry.versionName.trim(), ...entry.tags]
    .map(legadoBadgeText)
    .filter(Boolean)
    .join('\n')
}

function legadoItem(c: Context, entry: LibraryVersionEntry, latestChapterTitle: string | null): LegadoBookSearchItem {
  return {
    id: entry.bookVersionId,
    title: entry.title,
    author: entry.author,
    format: entry.format,
    kind: legadoKind(entry),
    wordCount: formatLegadoWordCount(entry.wordCount),
    latestChapterTitle,
    intro: entry.description,
    url: absoluteUrl(c, `/api/v1/legado/books/${entry.bookVersionId}`),
    coverUrl: coverUrl(c, entry.bookVersionId, entry.coverKey),
  }
}

async function exploreBooks(c: Context, scope: LegadoExploreScope, id?: string, libraryId?: string) {
  const parsed = legadoExploreSchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid Legado explore query', parsed.error.flatten())
  }

  const user = c.get('user')
  const sortBy = parsed.data.sort === 'updated' ? 'updatedAt' : parsed.data.sort === 'title' ? 'title' : 'createdAt'
  const sortOrder = parsed.data.order ?? (parsed.data.sort === 'title' ? 'asc' : 'desc')
  const requested = libraryId ?? legadoPrivateLibraryId(user.id)
  const filter = getLegadoExploreFilter(user.id, requested, scope, id)
  const libraryIds = libraryId ? [filter.libraryId] : legadoJoinedLibraryIds(user.id)
  return c.json({
    data: await legadoSearchItems(c, user.id, libraryIds, {
      page: parsed.data.page,
      sortBy,
      sortOrder,
      categoryId: filter.categoryId,
      tagId: filter.tagId,
    }),
  })
}

legadoRoutes.get('/explore/config', async (c) => {
  const user = c.get('user')
  const data = await getLegadoExploreConfig(user.id)
  return c.json({ data } satisfies { data: LegadoExploreConfigRes })
})

// `all` is the reader's own library plus every library they joined; the
// per-library routes are what the discovery buttons point at.
legadoRoutes.get('/explore/all', (c) => exploreBooks(c, 'all'))
legadoRoutes.get('/explore/libraries/:id', (c) => exploreBooks(c, 'all', undefined, c.req.param('id')))
legadoRoutes.get('/explore/libraries/:id/categories/:categoryId', (c) => exploreBooks(c, 'shelf', c.req.param('categoryId'), c.req.param('id')))
legadoRoutes.get('/explore/libraries/:id/tags/:tagId', (c) => exploreBooks(c, 'tag', c.req.param('tagId'), c.req.param('id')))

legadoRoutes.get('/search', async (c) => {
  const parsed = legadoSearchSchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid Legado search query', parsed.error.flatten())
  }

  const user = c.get('user')
  const libraryIds = parsed.data.scope === 'private'
    ? [legadoPrivateLibraryId(user.id)]
    : legadoJoinedLibraryIds(user.id)
  return c.json({
    data: await legadoSearchItems(c, user.id, libraryIds, {
      page: parsed.data.page,
      search: parsed.data.keyword || undefined,
    }),
  })
})

legadoRoutes.get('/books/:id', async (c) => {
  const user = c.get('user')
  const book = await getActiveBook(user.id, c.req.param('id'), LEGADO_READ)
  const wordCount = typeof book.meta.wordCount === 'number' && Number.isFinite(book.meta.wordCount) ? book.meta.wordCount : null
  // A version collected from a shared library keeps the publisher, series and
  // other publication fields the curator set, so the merged view is resolved
  // through the library listing rather than from the flat parsed revision meta.
  const entry = await getLibraryVersionPublication(user.id, book.id)
  // Badges come from the same library listing the list rows use, so a detail
  // page and its result row always agree. Reading them from the private
  // library's membership instead left a book that lives only in a shared
  // library showing its format badge and nothing else.
  const data: LegadoBookInfoRes = {
    id: book.id,
    title: entry?.title ?? book.title,
    author: book.author,
    format: book.format,
    kind: entry
      ? legadoKind({ format: book.format, categoryName: entry.categoryName, tags: entry.tags, versionName: entry.versionName })
      : bookKind(book, getBookMembership(user.id, book.id, book.shelfId)),
    description: entry?.description || bookDescription(book.meta),
    intro: bookIntro(book, entry?.bookmeta, entry?.fileName ?? null, getUserTimezone(user.id)),
    wordCount,
    coverUrl: coverUrl(c, book.id, book.coverKey),
    tocUrl: absoluteUrl(c, `/api/v1/legado/books/${book.id}/chapters`),
  }
  return c.json({ data })
})

legadoRoutes.get('/books/:id/cover', async (c) => {
  const user = c.get('user')
  const cover = await getBookCoverContent(user.id, c.req.param('id'), { size: 'thumb' })
  if (!cover) throw new AppError('BOOK_NOT_FOUND', 'No cover')
  return c.newResponse(new Uint8Array(cover.data), 200, { 'Content-Type': cover.contentType, 'Cache-Control': 'private, immutable, max-age=31536000' })
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
      contentUpdateDate: chapter.contentUpdateDate,
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
