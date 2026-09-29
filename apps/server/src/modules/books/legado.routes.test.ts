import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from '../../middleware/error'
import { authGuard } from '../../middleware/auth.guard'
import legadoRoutes from './legado.routes'
import {
  getLegadoBookResource,
  getLegadoChapterContent,
  getLegadoExploreConfig,
  getLegadoExploreFilter,
  getLegadoToc,
  legadoJoinedLibraryIds,
  legadoPrivateLibraryId,
  legadoLatestChapterTitles,
} from './legado.service'
import { getActiveBook, getBookMembership } from './books.service'
import { getLibraryVersionPublication, listLibraryVersionEntries, type LibraryVersionEntry } from '../libraries/catalog.service'
import { isLegadoAccessKeyEnabled, isLegadoEnabled, isLegadoEpubMediaEnabled } from '../settings/settings.service'
import { getOrCreateLegadoAccessKey, resolveLegadoAccessKey, rotateLegadoAccessKey } from './legado-access.service'

vi.mock('../settings/settings.service', () => ({
  isLegadoAccessKeyEnabled: vi.fn(() => true),
  isLegadoEnabled: vi.fn(() => true),
  isLegadoEpubMediaEnabled: vi.fn(() => true),
}))

vi.mock('./books.service', () => ({
  getActiveBook: vi.fn(),
  getBookMembership: vi.fn(),
}))

vi.mock('../libraries/catalog.service', () => ({
  listLibraryVersionEntries: vi.fn(),
  getLibraryVersionPublication: vi.fn(),
}))
vi.mock('./legado.service', () => ({
  getLegadoBookResource: vi.fn(),
  getLegadoChapterContent: vi.fn(),
  getLegadoExploreConfig: vi.fn(),
  getLegadoExploreFilter: vi.fn(),
  getLegadoToc: vi.fn(),
  legadoPrivateLibraryId: vi.fn(() => 'lib-private'),
  legadoJoinedLibraryIds: vi.fn(() => ['lib-private']),
  legadoLatestChapterTitles: vi.fn(() => new Map()),
  LEGADO_READ: { showHidden: true },
}))

vi.mock('../auth/auth.service', () => ({
  getUserTimezone: vi.fn(() => null),
}))

vi.mock('./legado-access.service', () => ({
  issueLegadoAccessKey: vi.fn(),
  getOrCreateLegadoAccessKey: vi.fn(() => ({ id: 'legado-key-1', token: 'bd_src_secret', createdAt: 100, expiresAt: null })),
  getLegadoAccessKeyInfo: vi.fn(() => ({ active: false, createdAt: null, expiresAt: null })),
  resolveLegadoAccessKey: vi.fn(),
  rotateLegadoAccessKey: vi.fn(),
}))

function createApp(withAuthGuard = false) {
  const app = new Hono()
  app.onError(errorHandler)
  if (withAuthGuard) {
    app.use('/api/v1/*', authGuard())
  } else {
    app.use('/api/v1/legado/*', async (c, next) => {
      c.set('user', { id: 'user-1', username: 'owner', role: 'owner', avatarKey: null })
      c.set('guest', false)
      return next()
    })
  }
  app.route('/api/v1/legado', legadoRoutes)
  return app
}

/** One row as the library listing returns it: a version, not a work. */
function versionEntry(overrides: Partial<LibraryVersionEntry> = {}): LibraryVersionEntry {
  return {
    bookVersionId: 'book-1',
    libraryBookId: 'work-1',
    versionName: '',
    title: 'Book One',
    author: 'Author',
    authors: ['Author'],
    format: 'txt',
    size: 100,
    coverKey: 'covers/book-1.jpg',
    description: 'A short description',
    wordCount: 1175000,
    categoryId: 'cat-1',
    categoryName: '网络小说',
    tags: ['都市'],
    bookmeta: { description: 'A short description' },
    fileName: 'Book One.txt',
    kind: 'personal',
    hidden: false,
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('Legado book-source adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isLegadoAccessKeyEnabled).mockReturnValue(true)
    vi.mocked(isLegadoEnabled).mockReturnValue(true)
    vi.mocked(isLegadoEpubMediaEnabled).mockReturnValue(true)
  })

  it('exposes an importable source definition without authentication', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    expect(response.status).toBe(200)

    const [source] = await response.json() as [{
      bookSourceUrl: string
      header: string
      loginUrl: string
      lastUpdateTime: number
      enabledCookieJar: boolean
      enabledExplore: boolean
      exploreUrl: string
      jsLib: string
      searchUrl: string
      ruleSearch: { bookList: string; kind: string; wordCount: string; lastChapter: string; intro: string }
      ruleExplore: { bookList: string; kind: string; wordCount: string; lastChapter: string; intro: string }
      ruleBookInfo: { kind: string }
      ruleToc: { chapterList: string; isVolume: string; updateTime: string }
      ruleContent: { content: string }
    }]
    expect(source).toMatchObject({
      bookSourceUrl: 'http://bookdock.test',
      bookSourceName: '书坞',
      bookSourceGroup: '书坞',
      header: '@js:\nvar cookieHeader = java.getCookie(baseUrl);\nresult = cookieHeader ? JSON.stringify({"Cookie": cookieHeader}) : "{}";',
      loginUrl: 'http://bookdock.test/api/v1/legado/login',
      lastUpdateTime: 1793731200000,
      enabledCookieJar: true,
      enabledExplore: true,
      exploreUrl: '@js:\n/* Bookdock explore 1793731200000 */\nresult = bdExplore(this);',
      jsLib: expect.stringContaining('BD_API_ROOT'),
      searchUrl: 'http://bookdock.test/api/v1/legado/search?keyword={{key}}&page={{page}}&scope=joined',
      ruleSearch: {
        bookList: '$.data.items[*]',
        kind: '$.kind',
        wordCount: '$.wordCount',
        lastChapter: '$.latestChapterTitle',
        intro: '$.intro',
      },
      ruleExplore: {
        bookList: '$.data.items[*]',
        kind: '$.kind',
        wordCount: '$.wordCount',
        lastChapter: '$.latestChapterTitle',
        intro: '$.intro',
      },
      ruleBookInfo: { kind: '$.data.kind' },
      ruleToc: { chapterList: '$.data.chapters[*]', isVolume: '$.isVolume', updateTime: '$.contentUpdateDate' },
      ruleContent: { content: '$.data.content' },
    })
    expect(() => new Function(source.jsLib)).not.toThrow()
    expect(() => new Function(source.header.replace(/^@js:\n/, ''))).not.toThrow()
  })

  it('uses the public HTTPS scheme throughout the source behind a TLS-terminating proxy', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json', {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'untrusted.test' },
    })
    const [source] = await response.json() as [{ bookSourceUrl: string; loginUrl: string; searchUrl: string; jsLib: string }]

    expect(source.bookSourceUrl).toBe('https://bookdock.test')
    expect(source.loginUrl).toBe('https://bookdock.test/api/v1/legado/login')
    expect(source.searchUrl).toBe('https://bookdock.test/api/v1/legado/search?keyword={{key}}&page={{page}}&scope=joined')
    expect(source.jsLib).toContain('var BD_API_ROOT = "https://bookdock.test/api/v1/legado"')
    expect(JSON.stringify(source)).not.toContain('untrusted.test')
  })

  it.each(['https,http', 'javascript', 'http'])('ignores an invalid or non-HTTPS proxy protocol %s', async (protocol) => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json', {
      headers: { 'X-Forwarded-Proto': protocol },
    })
    const [source] = await response.json() as [{ bookSourceUrl: string }]
    expect(source.bookSourceUrl).toBe('http://bookdock.test')
  })

  it('retains native HTTPS even when a proxy reports HTTP', async () => {
    const response = await createApp(true).request('https://bookdock.test/api/v1/legado/source.json', {
      headers: { 'X-Forwarded-Proto': 'http' },
    })
    const [source] = await response.json() as [{ bookSourceUrl: string }]
    expect(source.bookSourceUrl).toBe('https://bookdock.test')
  })

  it('restores an existing source cookie before opening the login page', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/login', {
      headers: { Cookie: 'bd_token=existing-token' },
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://bookdock.test/login?legado=1')
    expect(response.headers.get('set-cookie')).toContain('bd_token=existing-token')
  })

  it('redirects the source login bridge to the public HTTPS site', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/login', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    expect(response.headers.get('location')).toBe('https://bookdock.test/login?legado=1')
  })

  it('builds a key-authenticated source definition without a login bridge', async () => {
    vi.mocked(resolveLegadoAccessKey).mockReturnValue({ id: 'legado-key-1', userId: 'user-1', createdAt: 1, expiresAt: null })
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json?key=secret', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    expect(response.status).toBe(200)

    const [source] = await response.json() as [{ bookSourceUrl: string; header: string; enabledCookieJar: boolean; loginUrl: string }]
    expect(source).toMatchObject({
      bookSourceUrl: 'https://bookdock.test/api/v1/legado/source/legado-key-1',
      header: JSON.stringify({ Authorization: 'Bearer secret' }),
      enabledCookieJar: false,
      loginUrl: '',
    })
  })

  it('rejects a keyed source when access-key mode is disabled', async () => {
    vi.mocked(isLegadoAccessKeyEnabled).mockReturnValue(false)
    vi.mocked(resolveLegadoAccessKey).mockReturnValue({ id: 'legado-key-1', userId: 'user-1', createdAt: 1, expiresAt: null })

    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json?key=secret')

    expect(response.status).toBe(403)
  })

  it('returns the active source URL and import URL for the current user', async () => {
    vi.mocked(getOrCreateLegadoAccessKey).mockReturnValue({ id: 'legado-key-1', token: 'bd_src_secret', createdAt: 100, expiresAt: null })
    const response = await createApp().request('http://bookdock.test/api/v1/legado/access-key')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        active: true,
        sourceUrl: 'http://bookdock.test/api/v1/legado/source.json?key=bd_src_secret',
        importUrl: 'legado://import/bookSource?src=http%3A%2F%2Fbookdock.test%2Fapi%2Fv1%2Flegado%2Fsource.json%3Fkey%3Dbd_src_secret',
        createdAt: 100,
        expiresAt: null,
      },
    })
  })

  it('returns an HTTPS key-based import URL behind a TLS-terminating proxy', async () => {
    const response = await createApp().request('http://bookdock.test/api/v1/legado/access-key', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    const json = await response.json() as { data: { sourceUrl: string; importUrl: string } }
    expect(json.data.sourceUrl).toBe('https://bookdock.test/api/v1/legado/source.json?key=bd_src_secret')
    expect(json.data.importUrl).toBe(`legado://import/bookSource?src=${encodeURIComponent(json.data.sourceUrl)}`)
  })

  it('rotates and issues an import URL for the current user', async () => {
    vi.mocked(rotateLegadoAccessKey).mockReturnValue({ id: 'legado-key-1', token: 'bd_src_secret', createdAt: 100, expiresAt: 200 })
    const response = await createApp().request('http://bookdock.test/api/v1/legado/access-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: '90d' }),
    })

    expect(response.status).toBe(200)
    expect(rotateLegadoAccessKey).toHaveBeenCalledWith('user-1', '90d')
    await expect(response.json()).resolves.toEqual({
      data: {
        sourceUrl: 'http://bookdock.test/api/v1/legado/source.json?key=bd_src_secret',
        importUrl: 'legado://import/bookSource?src=http%3A%2F%2Fbookdock.test%2Fapi%2Fv1%2Flegado%2Fsource.json%3Fkey%3Dbd_src_secret',
        createdAt: 100,
        expiresAt: 200,
      },
    })
  })

  it('builds discovery rows through the explore callback context', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    const sourceContext = {
      getKey: () => 'http://bookdock.test',
      getVariable: () => '',
    }
    const javaContext = {
      ajax: vi.fn(() => JSON.stringify({
        data: {
          libraries: [{
            id: 'lib-private',
            name: '我的书库',
            type: 'private',
            categories: [
              { id: 'none', name: '未分类', depth: 0 },
              { id: 'cat-1', name: '网络小说', depth: 0 },
              { id: 'cat-1-1', name: '都市', depth: 1 },
            ],
            tags: [{ id: 'tag-1', name: '完结', depth: 0 }],
          }],
        },
      })),
    }
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)
    const rows = JSON.parse(runExplore(sourceContext, javaContext) as string) as Array<{ title: string; url: string; type?: string; style?: { layout_flexBasisPercent?: number } }>

    expect(javaContext.ajax).toHaveBeenCalledWith('http://bookdock.test/api/v1/legado/explore/config')
    expect(rows[0]).toMatchObject({ title: '排序', type: 'select', style: { layout_flexBasisPercent: 0.45 } })
    expect(rows[1]).toMatchObject({ title: '顺序', type: 'select', style: { layout_flexBasisPercent: 0.45 } })
    // A single library keeps the familiar flat headings, with no library prefix.
    expect(rows[2]).toEqual({
      title: '全部书籍',
      url: 'http://bookdock.test/api/v1/legado/explore/all?scope=joined&page={{page}}&sort=updated&order=desc',
      style: { layout_flexGrow: 1, layout_flexBasisPercent: 1 },
    })
    expect(rows).toEqual(expect.arrayContaining([
      // A separator is an empty-url row, which Legado centres. The reader's own
      // library keeps the 书架 wording rather than 分类.
      { title: '—— 书架 ——', url: '', style: { layout_flexGrow: 1, layout_flexBasisPercent: 1 } },
      { title: '—— 标签 ——', url: '', style: { layout_flexGrow: 1, layout_flexBasisPercent: 1 } },
      expect.objectContaining({ title: '网络小说', url: expect.stringContaining('/explore/libraries/lib-private/categories/cat-1?') }),
      // A nested category is marked by indentation, since the list is flat.
      expect.objectContaining({ title: '　都市', url: expect.stringContaining('/categories/cat-1-1?') }),
      expect.objectContaining({ title: '完结', url: expect.stringContaining('/explore/libraries/lib-private/tags/tag-1?') }),
    ]))
  })

  it('names the library in every section once more than one is browsable', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    const javaContext = {
      ajax: vi.fn(() => JSON.stringify({
        data: {
          libraries: [
            { id: 'lib-private', name: '我的书库', type: 'private', categories: [], tags: [{ id: 'tag-1', name: '完结', depth: 0 }] },
            { id: 'lib-city', name: '城市书库', type: 'shared', categories: [{ id: 'cat-9', name: '科幻', depth: 0 }], tags: [] },
          ],
        },
      })),
    }
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)
    const rows = JSON.parse(runExplore(
      { getKey: () => 'http://bookdock.test', getVariable: () => '' },
      javaContext,
    ) as string) as Array<{ title: string; url: string; type?: string }>

    // One full-width row per library instead of a single "全部书籍".
    expect(rows.filter((row) => row.title.startsWith('全部 · '))).toEqual([
      expect.objectContaining({ title: '全部 · 我的书库', url: expect.stringContaining('/explore/libraries/lib-private?') }),
      expect.objectContaining({ title: '全部 · 城市书库', url: expect.stringContaining('/explore/libraries/lib-city?') }),
    ])
    expect(rows.some((row) => row.title === '全部书籍')).toBe(false)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '—— 我的书库 · 书架 ——' }),
      expect.objectContaining({ title: '—— 我的书库 · 标签 ——' }),
      // A shared library's taxonomy is 分类, not 书架.
      expect.objectContaining({ title: '—— 城市书库 · 分类 ——' }),
      expect.objectContaining({ title: '—— 城市书库 · 标签 ——' }),
      // An empty dimension says so instead of rendering nothing, using the same
      // wording as its heading.
      expect.objectContaining({ title: '暂无书架' }),
      expect.objectContaining({ title: '暂无标签' }),
      expect.objectContaining({ title: '科幻', url: expect.stringContaining('/explore/libraries/lib-city/categories/cat-9?') }),
    ]))
  })

  it('translates persisted discovery sort values into result URLs', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    let state = { bdSortField: 'title', bdSortOrder: 'asc' }
    const sourceContext = {
      getKey: () => 'http://bookdock.test',
      getVariable: () => JSON.stringify(state),
    }
    const javaContext = {
      ajax: vi.fn(() => JSON.stringify({ data: { libraries: [] } })),
    }
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)

    let rows = JSON.parse(runExplore(sourceContext, javaContext) as string) as Array<{ title: string; url: string }>
    // No library at all is reported, not rendered as an empty book list.
    expect(rows[2]?.title).toBe('暂无可浏览的书库')
    expect(rows.some((row) => row.title === '全部书籍')).toBe(false)

    state = { bdSortField: 'added', bdSortOrder: 'desc' }
    javaContext.ajax.mockReturnValue(JSON.stringify({
      data: { libraries: [{ id: 'lib-private', name: '我的书库', type: 'private', categories: [], tags: [] }] },
    }))
    rows = JSON.parse(runExplore(sourceContext, javaContext) as string) as Array<{ title: string; url: string }>
    expect(rows[2]?.url).toContain('/explore/all?scope=joined&page={{page}}&sort=added&order=desc')

    state = { bdSortField: 'title', bdSortOrder: 'asc' }
    rows = JSON.parse(runExplore(sourceContext, javaContext) as string) as Array<{ title: string; url: string }>
    expect(rows[2]?.url).toContain('/explore/all?scope=joined&page={{page}}&sort=title&order=asc')
  })

  it('asks the reader to sign in when the config request is unauthorized', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)
    const rows = JSON.parse(runExplore(
      { getVariable: () => '' },
      { ajax: () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }) },
    ) as string) as Array<{ title: string; url: string }>

    // Not a request failure: the reader is simply not signed in, and the row
    // says which action fixes it.
    expect(rows[0]?.title).toBe('—— 未登录书坞 ——')
    expect(rows[1]?.title).toContain('点登录')
    expect(rows.some((row) => row.title.includes('发现加载失败'))).toBe(false)
  })

  it('treats a rejected guest session as not signed in rather than a failure', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)

    // With guest access on, the guard admits a guest and the facade refuses
    // that session, so the reader sees FORBIDDEN rather than 401.
    const guest = JSON.parse(runExplore(
      { getVariable: () => '' },
      { ajax: () => JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot use Legado integration' } }) },
    ) as string) as Array<{ title: string }>
    expect(guest[0]?.title).toBe('—— 未登录书坞 ——')

    // A disabled integration is also FORBIDDEN, but telling the reader to sign
    // in would send them down the wrong path.
    const disabled = JSON.parse(runExplore(
      { getVariable: () => '' },
      { ajax: () => JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Legado book source is disabled' } }) },
    ) as string) as Array<{ title: string }>
    expect(disabled[0]?.title).toBe('—— 发现加载失败：书源服务已关闭 ——')
  })

  it('still reports other discovery failures as failures', async () => {
    const response = await createApp(true).request('http://bookdock.test/api/v1/legado/source.json')
    const [source] = await response.json() as [{ jsLib: string }]
    const runExplore = new Function('source', 'java', `${source.jsLib}; return bdExplore({ source: source, java: java });`)
    const rows = JSON.parse(runExplore(
      { getVariable: () => '' },
      { ajax: () => { throw new Error('HttpException: 500'); } },
    ) as string) as Array<{ title: string }>

    expect(rows[0]?.title).toBe('—— 发现加载失败：接口请求失败 ——')
  })

  it('returns every browsable library with its own taxonomy', async () => {
    vi.mocked(getLegadoExploreConfig).mockResolvedValue({
      libraries: [
        { id: 'lib-private', name: '我的书库', type: 'private', categories: [{ id: 'cat-1', name: '网络小说', depth: 0 }], tags: [] },
        { id: 'lib-city', name: '城市书库', type: 'shared', categories: [], tags: [{ id: 'tag-9', name: '科幻', depth: 0 }] },
      ],
    })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/explore/config')

    await expect(response.json()).resolves.toEqual({
      data: {
        libraries: [
          { id: 'lib-private', name: '我的书库', type: 'private', categories: [{ id: 'cat-1', name: '网络小说', depth: 0 }], tags: [] },
          { id: 'lib-city', name: '城市书库', type: 'shared', categories: [], tags: [{ id: 'tag-9', name: '科幻', depth: 0 }] },
        ],
      },
    })
    expect(getLegadoExploreConfig).toHaveBeenCalledWith('user-1')
  })

  it('maps a category discovery page scoped to one library', async () => {
    vi.mocked(getLegadoExploreFilter).mockReturnValue({ libraryId: 'lib-city', categoryId: 'cat-9' })
    vi.mocked(listLibraryVersionEntries).mockResolvedValue({
      items: [versionEntry({ categoryName: '科幻', tags: ['高分'] })],
      total: 1,
      page: 2,
      pageSize: 24,
    })
    vi.mocked(legadoLatestChapterTitles).mockReturnValue(new Map([['book-1', 'Chapter One']]))

    const response = await createApp().request('http://bookdock.test/api/v1/legado/explore/libraries/lib-city/categories/cat-9?page=2&sort=title&order=desc')

    // The taxonomy id is validated against the library it was asked for, so a
    // category from another library cannot answer for this one.
    expect(getLegadoExploreFilter).toHaveBeenCalledWith('user-1', 'lib-city', 'shelf', 'cat-9')
    expect(listLibraryVersionEntries).toHaveBeenCalledWith('user-1', 'lib-city', expect.objectContaining({
      page: 2,
      sortBy: 'title',
      sortOrder: 'desc',
      categoryId: 'cat-9',
    }))
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          title: 'Book One',
          kind: 'txt\n科幻\n高分',
          latestChapterTitle: 'Chapter One',
        }],
        page: 2,
        total: 1,
      },
    })
  })

  it('maps owned books into Legado search results', async () => {
    vi.mocked(listLibraryVersionEntries).mockResolvedValue({
      items: [versionEntry()],
      total: 1,
      page: 1,
      pageSize: 24,
    })
    vi.mocked(legadoLatestChapterTitles).mockReturnValue(new Map([['book-1', '第一章 新章节']]))

    const response = await createApp().request('http://bookdock.test/api/v1/legado/search?keyword=Book%20One')
    expect(response.status).toBe(200)
    expect(listLibraryVersionEntries).toHaveBeenCalledWith('user-1', 'lib-private', expect.objectContaining({
      page: 1,
      search: 'Book One',
    }))
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [{
          id: 'book-1',
          title: 'Book One',
          author: 'Author',
          format: 'txt',
          kind: 'txt\n网络小说\n都市',
          wordCount: '117.5万字',
          latestChapterTitle: '第一章 新章节',
          intro: 'A short description',
          url: 'http://bookdock.test/api/v1/legado/books/book-1',
          coverUrl: 'http://bookdock.test/api/v1/legado/books/book-1/cover',
        }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    })
  })

  it('searches the private library and every joined library by default', async () => {
    vi.mocked(legadoJoinedLibraryIds).mockReturnValue(['lib-private', 'lib-city'])
    vi.mocked(listLibraryVersionEntries)
      .mockResolvedValueOnce({ items: [versionEntry()], total: 1, page: 1, pageSize: 24 })
      .mockResolvedValueOnce({ items: [versionEntry({ bookVersionId: 'book-2', libraryBookId: 'work-2', title: 'Shared Book', coverKey: null })], total: 1, page: 1, pageSize: 24 })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/search?keyword=%E4%B9%A6')
    expect(response.status).toBe(200)
    expect(vi.mocked(listLibraryVersionEntries).mock.calls.map((call) => call[1])).toEqual(['lib-private', 'lib-city'])
    const json = await response.json() as { data: { items: { id: string }[]; total: number } }
    expect(json.data.items.map((item) => item.id)).toEqual(['book-1', 'book-2'])
    expect(json.data.total).toBe(2)
  })

  it('narrows the search to the private library on request', async () => {
    vi.mocked(listLibraryVersionEntries).mockResolvedValue({ items: [versionEntry()], total: 1, page: 1, pageSize: 24 })

    await createApp().request('http://bookdock.test/api/v1/legado/search?keyword=x&scope=private')

    expect(legadoPrivateLibraryId).toHaveBeenCalledWith('user-1')
    expect(legadoJoinedLibraryIds).not.toHaveBeenCalled()
  })

  it('carries a named version as a badge instead of rewriting the title', async () => {
    vi.mocked(getLegadoExploreFilter).mockReturnValue({ libraryId: 'lib-private' })
    vi.mocked(listLibraryVersionEntries).mockResolvedValue({
      items: [versionEntry({ versionName: '精校版' })],
      total: 1,
      page: 1,
      pageSize: 24,
    })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/explore/all')
    const json = await response.json() as { data: { items: { title: string; kind: string }[] } }
    // The title stays the name the reader recognises; the version label rides in
    // the badge list with the format, the category and the tags.
    expect(json.data.items[0]?.title).toBe('Book One')
    expect(json.data.items[0]?.kind.split('\n')).toEqual(['txt', '网络小说', '精校版', '都市'])
  })

  it('badges the detail page from the library holding the book, not the private one', async () => {
    vi.mocked(getActiveBook).mockResolvedValue({
      id: 'book-9', title: 'Shared Book', author: 'Author', format: 'epub', coverKey: null, size: 100,
      createdAt: 1, updatedAt: 1, meta: { bookmeta: {}, wordCount: 10 }, shelfId: null,
    } as unknown as Awaited<ReturnType<typeof getActiveBook>>)
    // The private library holds nothing for this version, so its membership has
    // no shelf and no tags to contribute.
    vi.mocked(getBookMembership).mockReturnValue({ shelfName: null, tags: [] })
    vi.mocked(getLibraryVersionPublication).mockResolvedValue({
      versionName: '精校版',
      title: 'Shared Book',
      description: 'A city tale',
      categoryName: '科幻',
      tags: ['高分', '完结'],
      bookmeta: {},
      fileName: 'shared.epub',
    })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/books/book-9')
    const json = await response.json() as { data: { kind: string; title: string; description: string } }

    expect(json.data.kind.split('\n')).toEqual(['epub', '科幻', '精校版', '高分', '完结'])
    expect(json.data.title).toBe('Shared Book')
    expect(json.data.description).toBe('A city tale')
  })

  it('maps book info, TOC, and chapter content for Legado', async () => {
    vi.mocked(getActiveBook).mockResolvedValue({
      id: 'book-1',
      title: 'Book One',
      author: 'Author',
      format: 'txt',
      coverKey: null,
      size: 100,
      createdAt: Date.UTC(2026, 8, 18),
      updatedAt: Date.UTC(2026, 8, 18),
      meta: { fileName: 'Book One.txt', bookmeta: { description: 'A short description' }, wordCount: 123 },
      readStatus: 'reading',
      shelfId: 'shelf-1',
    } as unknown as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(getBookMembership).mockReturnValue({ shelfName: '待读', tags: ['都市', '动作'] })
    vi.mocked(getLegadoToc).mockResolvedValue([{
      id: 'chapter-1',
      index: 0,
      title: 'Chapter One',
      level: 1,
      isVolume: true,
      contentUpdateDate: '2026-09-18',
    }, {
      id: 'chapter-2',
      index: 1,
      title: '　　Section One',
      level: 2,
      isVolume: false,
      contentUpdateDate: '2026-09-18',
    }])
    vi.mocked(getLegadoChapterContent).mockResolvedValue({
      id: 'chapter-1',
      index: 0,
      title: 'Chapter One',
      content: 'Chapter content',
    })

    const app = createApp()
    const detailResponse = await app.request('http://bookdock.test/api/v1/legado/books/book-1')
    const tocResponse = await app.request('http://bookdock.test/api/v1/legado/books/book-1/chapters', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    const chapterResponse = await app.request('http://bookdock.test/api/v1/legado/books/book-1/chapters/0')

    await expect(detailResponse.json()).resolves.toMatchObject({
      data: {
        id: 'book-1',
        description: 'A short description',
        intro: '<usehtml><div>内容简介：</div><div>　　A short description</div><div><br></div><div>书籍信息：</div><div>　　文件大小：100 B</div><div>　　原始文件：Book One.txt</div><div>　　添加时间：2026-09-18 00:00</div></usehtml>',
        kind: 'txt\n待读\n都市\n动作',
        wordCount: 123,
        tocUrl: 'http://bookdock.test/api/v1/legado/books/book-1/chapters',
      },
    })
    await expect(tocResponse.json()).resolves.toEqual({
      data: {
        chapters: [{
          id: 'chapter-1',
          index: 0,
          title: 'Chapter One',
          level: 1,
          isVolume: true,
          contentUpdateDate: '2026-09-18',
          url: 'Chapter One0',
        }, {
          id: 'chapter-2',
          index: 1,
          title: '　　Section One',
          level: 2,
          isVolume: false,
          contentUpdateDate: '2026-09-18',
          url: 'https://bookdock.test/api/v1/legado/books/book-1/chapters/1',
        }],
      },
    })
    await expect(chapterResponse.json()).resolves.toEqual({
      data: {
        id: 'chapter-1',
        index: 0,
        title: 'Chapter One',
        content: 'Chapter content',
      },
    })
  })

  it('serves an authenticated EPUB media resource with its media type', async () => {
    vi.mocked(getLegadoBookResource).mockResolvedValue({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: 'image/png',
    })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/books/book-1/resource?path=OEBPS%2FImages%2Fcover.png')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(getLegadoBookResource).toHaveBeenCalledWith('user-1', 'book-1', 'OEBPS/Images/cover.png')
  })

  it('escapes detail intro text and preserves description line breaks', async () => {
    vi.mocked(getActiveBook).mockResolvedValue({
      id: 'book-1',
      title: 'Book One',
      author: 'Author',
      format: 'epub',
      coverKey: null,
      size: 100,
      createdAt: Date.UTC(2026, 0, 2),
      updatedAt: Date.UTC(2026, 0, 3),
      readStatus: 'reading',
      shelfId: null,
      meta: { fileName: 'Book <One>.epub', bookmeta: { description: 'A <short> & useful\nsummary\n\nSecond paragraph' } },
    } as unknown as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(getBookMembership).mockReturnValue({ shelfName: null, tags: [] })

    const response = await createApp().request('http://bookdock.test/api/v1/legado/books/book-1')

    await expect(response.json()).resolves.toMatchObject({
      data: {
        intro: '<usehtml><div>内容简介：</div><div>　　A &lt;short&gt; &amp; useful<br>summary</div><div><br></div><div>　　Second paragraph</div><div><br></div><div>书籍信息：</div><div>　　文件大小：100 B</div><div>　　原始文件：Book &lt;One&gt;.epub</div><div>　　添加时间：2026-01-02 00:00</div><div>　　最后更新：2026-01-03 00:00</div></usehtml>',
      },
    })
  })

  it('returns 403 when Legado book source is disabled by user setting', async () => {
    vi.mocked(isLegadoEnabled).mockReturnValue(false)
    const response = await createApp().request('http://bookdock.test/api/v1/legado/search?keyword=test')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Legado book source is disabled' },
    })
  })

  it('injects access key into cover and chapter resource URLs when authenticated via access key', async () => {
    vi.mocked(getActiveBook).mockResolvedValue({
      id: 'book-1',
      title: 'Book One',
      author: 'Author One',
      format: 'epub',
      coverKey: 'covers/book-1.jpg',
      size: 100,
      createdAt: 1,
      updatedAt: 1,
      readStatus: 'unread',
      shelfId: null,
      meta: {},
    } as unknown as Awaited<ReturnType<typeof getActiveBook>>)
    vi.mocked(getBookMembership).mockReturnValue({ shelfName: null, tags: [] })

    const app = new Hono()
    app.use('/api/v1/legado/*', async (c, next) => {
      c.set('user', { id: 'user-1', username: 'owner', role: 'owner', avatarKey: null })
      c.set('guest', false)
      c.set('legadoAccessKey', true)
      c.set('legadoToken', 'bd_src_token_123')
      return next()
    })
    app.route('/api/v1/legado', legadoRoutes)

    const detailResponse = await app.request('http://bookdock.test/api/v1/legado/books/book-1', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    const json = await detailResponse.json() as { data: { coverUrl: string } }
    expect(json.data.coverUrl).toBe('https://bookdock.test/api/v1/legado/books/book-1/cover?key=bd_src_token_123')

    vi.mocked(getLegadoChapterContent).mockResolvedValueOnce({
      id: 'chapter-1',
      index: 0,
      title: 'Chapter 1',
      content: 'Content',
    })
    await app.request('http://bookdock.test/api/v1/legado/books/book-1/chapters/0', {
      headers: { 'X-Forwarded-Proto': 'https' },
    })
    expect(getLegadoChapterContent).toHaveBeenCalledWith(
      'user-1',
      'book-1',
      0,
      expect.any(Function),
      true,
    )
    const resourceUrl = vi.mocked(getLegadoChapterContent).mock.calls[0]?.[3]
    expect(resourceUrl?.('OEBPS/Images/cover.png')).toBe('https://bookdock.test/api/v1/legado/books/book-1/resource?path=OEBPS%2FImages%2Fcover.png&key=bd_src_token_123')
  })

  it('passes false for includeMedia when disabled in settings', async () => {
    vi.mocked(isLegadoEpubMediaEnabled).mockReturnValue(false)
    vi.mocked(getLegadoChapterContent).mockResolvedValueOnce({
      id: 'chapter-1',
      index: 0,
      title: 'Chapter 1',
      content: 'Content',
    })
    const app = createApp()
    await app.request('http://bookdock.test/api/v1/legado/books/book-1/chapters/0')
    expect(getLegadoChapterContent).toHaveBeenCalledWith(
      'user-1',
      'book-1',
      0,
      expect.any(Function),
      false,
    )
  })
})
