import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { updateTimezone } from '../auth/auth.service'
import type { BookReplacementRule } from './replacement-rules'
import {
  getLegadoExploreConfig,
  getLegadoExploreFilter,
  getLegadoToc,
  legadoJoinedLibraryIds,
  legadoLatestChapterTitles,
  legadoPrivateLibraryId,
  projectEpubChapterMarkup,
  projectTxtChapterContent,
} from './legado.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '../../db/migrations') })
  return db
}

function rule(partial: Partial<BookReplacementRule>): BookReplacementRule {
  return {
    id: partial.id ?? 'rule-1',
    matchType: partial.matchType ?? 'pattern',
    pattern: partial.pattern ?? null,
    replacement: partial.replacement ?? null,
    isRegex: partial.isRegex ?? false,
    applyTo: partial.applyTo ?? 'content',
    effectiveEnabled: partial.effectiveEnabled ?? true,
    spineHref: partial.spineHref ?? null,
    textOffset: partial.textOffset ?? null,
    originalText: partial.originalText ?? null,
  }
}

describe('Legado chapter replacement projection', () => {
  const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Hidden title</title></head><body><h1>Chapter One</h1><p>Hello <em>world</em>.</p><p>Second paragraph.</p></body></html>`

  it('applies content and title pattern rules to EPUB markup', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({ id: 'content', pattern: 'world', replacement: 'Bookdock', applyTo: 'content' }),
      rule({ id: 'title', pattern: 'One', replacement: '1', applyTo: 'title' }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('<usehtml>')
    expect(content).toContain('<h1>Chapter 1</h1>')
    expect(content).toContain('<p>Hello <em>Bookdock</em>.</p>')
    expect(content).toContain('<p>Second paragraph.</p>')
  })

  it('applies an enabled point patch against the matching section href', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0001.xhtml',
        originalText: 'world',
        textOffset: 20,
      }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('Hello <em>reader</em>.')
  })

  it('does not apply a point patch to a different section', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0002.xhtml',
        originalText: 'world',
        textOffset: 20,
      }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('Hello <em>world</em>.')
  })

  it('preserves full-width indentation before inline EPUB elements', () => {
    const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>　　<span style="color:#008080">“我怎么没正行了，我正经着呢。”</span></p><img src="../Images/cover.jpg"/></body></html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/chapter.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
    )

    expect(content).toContain('<p>　　<font color="#008080">')
  })

  it('removes only a leading EPUB heading duplicated by Legado', () => {
    const duplicateHeadingMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>\n<h2>第一章<br/>故人来访</h2><p>正文第一段。</p><h2>正文中的小标题</h2><p>正文第二段。</p></body></html>`
    const content = projectEpubChapterMarkup(
      duplicateHeadingMarkup,
      [],
      'OEBPS/Text/chapter.xhtml',
      undefined,
      [],
      '第一章 故人来访',
    )

    expect(content).not.toContain('<h2>第一章')
    expect(content).toContain('正文第一段。')
    expect(content).toContain('正文中的小标题')
    expect(content).toContain('正文第二段。')
  })

  it('removes a duplicated EPUB heading after a decorative leading block', () => {
    const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><div class="logo"><img src="../Images/logo.png"/></div><h2 class="head"><span>第一章</span><br/>庄周梦蝶？</h2><p>正文第一段。</p></body></html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/Chapter002.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [],
      '第一章 庄周梦蝶？',
    )

    expect(content).toContain('<usehtml>')
    expect(content).toContain('path=OEBPS%2FImages%2Flogo.png')
    expect(content).toContain('正文第一段。')
    expect(content).not.toContain('庄周梦蝶？')
  })

  it('projects basic inline EPUB styles without carrying CSS declarations', () => {
    const styledMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p><span class="dialogue" style="color:#008080;font-weight:bold;font-style:italic;text-decoration:underline line-through">彩色文字</span></p></body></html>`
    const content = projectEpubChapterMarkup(styledMarkup, [], 'OEBPS/Text/chapter.xhtml')

    expect(content).toContain('<usehtml>')
    expect(content).toContain('<font color="#008080"><b><i><u><s>彩色文字</s></u></i></b></font>')
    expect(content).not.toContain('style=')
    expect(content).not.toContain('class=')
  })

  it('keeps EPUB images and projects media clicks to the Legado player', () => {
    const mediaMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p><img alt="Cover" src="../Images/cover.jpg"/><video poster="../Images/poster.jpg"><source src="../Video/demo.mp4" type="video/mp4"/></video></body></html>`
    const content = projectEpubChapterMarkup(
      mediaMarkup,
      [],
      'OEBPS/Text/chapter.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [{ type: 'audio', path: 'OEBPS/Audio/chapter.mp3' }],
    )

    expect(content).toContain('<usehtml>')
    expect(content).toContain('path=OEBPS%2FImages%2Fcover.jpg')
    expect(content).toContain('path=OEBPS%2FImages%2Fposter.jpg')
    expect(content).toContain('path=OEBPS%2FVideo%2Fdemo.mp4')
    expect(content).toContain('path=OEBPS%2FAudio%2Fchapter.mp3')
    expect(content).toContain('java.openVideoPlayer')
    expect(content).toContain('true)')
    expect(content).not.toContain('false)')
    expect(content).toContain('data:image/svg+xml;base64,')
    expect(content).not.toContain('<a href=')
    expect(content).not.toContain('<video')
  })

  it('projects generated TXT chapter runs with the deterministic section href', () => {
    const projected = projectTxtChapterContent('Chapter One', 'Hello world.\n\nSecond paragraph.', [
      rule({ pattern: 'Chapter', replacement: 'Part', applyTo: 'title' }),
      rule({ pattern: 'world', replacement: 'Bookdock', applyTo: 'content' }),
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0001.xhtml',
        originalText: 'Second',
        textOffset: 20,
      }),
    ], 0)

    expect(projected).toEqual({ title: 'Part One', content: 'Hello Bookdock.\n\nreader paragraph.' })
  })

  it('removes an exact repeated TXT heading while preserving a non-identical opening', () => {
    expect(projectTxtChapterContent('第370章 入邺都', '入邺都\n\n将家里安顿好之后', [], 0)).toEqual({
      title: '第370章 入邺都',
      content: '将家里安顿好之后',
    })
    expect(projectTxtChapterContent('第370章 入邺都', '第370章 入邺都\n\n将家里安顿好之后', [], 0)).toEqual({
      title: '第370章 入邺都',
      content: '将家里安顿好之后',
    })
    expect(projectTxtChapterContent('第370章 入邺都', '入邺都之后，许青和紫女告别', [], 0).content)
      .toBe('入邺都之后，许青和紫女告别')
  })

  it('strips images, audio, and video when includeMedia is disabled', () => {
    const markup = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>Chapter 1</h1>
    <p>Opening text.</p>
    <img src="../Images/illustration.jpg" alt="插图" />
    <video src="../Video/demo.mp4" poster="../Images/poster.jpg" />
    <p>Closing text.</p>
  </body>
</html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/chapter-0001.xhtml',
      (path) => `http://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [{ type: 'audio', path: 'OEBPS/Audio/bgm.mp3' }],
      'Chapter 1',
      false,
    )

    expect(content).not.toContain('<img')
    expect(content).not.toContain('illustration.jpg')
    expect(content).not.toContain('demo.mp4')
    expect(content).not.toContain('bgm.mp3')
    expect(content).toContain('Opening text.')
    expect(content).toContain('Closing text.')
  })
})

/**
 * The discovery surface used to read the frozen `shelves`/`tags` tables, which
 * no longer receive writes: a shelf created in the Web was invisible to the
 * book source, and a fresh instance showed an empty discovery page. These cover
 * the library taxonomy it reads now.
 */
describe('Legado discovery configuration', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let privateLibraryId: string
  let sharedLibraryId: string
  let publicLibraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    return id
  }

  function seedCategory(libraryId: string, userId: string, name: string, parentId: string | null = null, hidden = false) {
    const id = createId('cat')
    db.insert(schema.libraryCategories).values({
      id, libraryId, userId, name, parentId, sortOrder: 0, pinned: false, hidden, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function seedTag(libraryId: string, userId: string, name: string, hidden = false) {
    const id = createId('ltag')
    db.insert(schema.libraryTags).values({
      id, libraryId, userId, name, sortOrder: 0, pinned: false, hidden, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function seedWork(libraryId: string, userId: string) {
    const workId = createId('lbook')
    const versionId = createId('book')
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId, userId, title: 'Book One', author: 'A', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.bookVersions).values({ id: versionId, format: 'txt', size: 10, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: versionId,
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    // The listing joins the latest revision, so a version without one is not
    // listed: it could not be read either.
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey: 'blobs/aa/b.epub',
      size: 10, chapterCount: 0, wordCount: 100, meta: { fileName: 'book.txt' }, createdAt: 1,
    }).run()
    return { workId, versionId }
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser('owner')
    memberId = seedUser('member')
    privateLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: privateLibraryId, userId: ownerId, type: 'private', name: '',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    sharedLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: sharedLibraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'password', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedLibraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    publicLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: publicLibraryId, userId: ownerId, type: 'shared', name: 'Open',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
  })

  it('reads the library taxonomy, not the frozen legacy tables', async () => {
    const root = seedCategory(privateLibraryId, ownerId, '网络小说')
    seedCategory(privateLibraryId, ownerId, '都市', root)
    seedTag(privateLibraryId, ownerId, '完结')
    seedWork(privateLibraryId, ownerId)

    const config = await getLegadoExploreConfig(ownerId)

    expect(config.libraries).toHaveLength(1)
    const [library] = config.libraries
    expect(library).toMatchObject({ id: privateLibraryId, type: 'private' })
    // Uncategorized leads, then the tree carrying its depth for indentation.
    expect(library!.categories.map((row) => [row.id === 'none' ? 'none' : row.name, row.depth])).toEqual([
      ['none', 0],
      ['网络小说', 0],
      ['都市', 1],
    ])
    expect(library!.tags.map((row) => row.name)).toEqual(['完结'])
  })

  it('keeps hidden taxonomy for a manager, in the reader\'s own library too', async () => {
    // The source already lists the owner's hidden books, so hiding their shelf
    // rows would only make a visible book unreachable by category.
    const hiddenCategory = seedCategory(privateLibraryId, ownerId, '藏书架', null, true)
    const hiddenTag = seedTag(privateLibraryId, ownerId, '藏标签', true)
    seedCategory(privateLibraryId, ownerId, '网络小说')
    seedTag(privateLibraryId, ownerId, '完结')
    seedWork(privateLibraryId, ownerId)

    const config = await getLegadoExploreConfig(ownerId)
    const [library] = config.libraries

    expect(library!.categories.map((row) => row.id)).toContain(hiddenCategory)
    expect(library!.tags.map((row) => row.id)).toContain(hiddenTag)
    // And a hidden category still resolves as a filter, or its books would be
    // listed with no way to narrow to them.
    expect(getLegadoExploreFilter(ownerId, privateLibraryId, 'shelf', hiddenCategory))
      .toEqual({ libraryId: privateLibraryId, categoryId: hiddenCategory })
    expect(getLegadoExploreFilter(ownerId, privateLibraryId, 'tag', hiddenTag))
      .toEqual({ libraryId: privateLibraryId, tagId: hiddenTag })
  })

  it('hides hidden taxonomy from an ordinary member of a shared library', async () => {
    const hiddenCategory = seedCategory(sharedLibraryId, ownerId, '藏书架', null, true)
    const hiddenTag = seedTag(sharedLibraryId, ownerId, '藏标签', true)
    const catVisible = seedCategory(sharedLibraryId, ownerId, '网络小说')
    const tagVisible = seedTag(sharedLibraryId, ownerId, '完结')
    seedWork(sharedLibraryId, ownerId)

    // The owner curates it, so the owner sees everything.
    const asOwner = await getLegadoExploreConfig(ownerId)
    const ownerLibrary = asOwner.libraries.find((row) => row.id === sharedLibraryId)!
    expect(ownerLibrary.categories.map((row) => row.id)).toContain(hiddenCategory)
    expect(ownerLibrary.tags.map((row) => row.id)).toContain(hiddenTag)

    // A plain member is bound by every hide, including the taxonomy rows.
    const asMember = await getLegadoExploreConfig(memberId)
    const memberLibrary = asMember.libraries.find((row) => row.id === sharedLibraryId)!
    expect(memberLibrary.categories.map((row) => row.id)).not.toContain(hiddenCategory)
    expect(memberLibrary.tags.map((row) => row.id)).not.toContain(hiddenTag)
    expect(memberLibrary.categories.map((row) => row.id)).toContain(catVisible)
    expect(memberLibrary.tags.map((row) => row.id)).toContain(tagVisible)
  })

  it('lists the private library first, then the joined ones, and never an unjoined public library', () => {
    seedWork(privateLibraryId, ownerId)
    seedWork(sharedLibraryId, ownerId)
    seedWork(publicLibraryId, ownerId)

    // The reader owns no private library here, so it is created on demand.
    expect(legadoPrivateLibraryId(memberId)).not.toBe(privateLibraryId)

    // Owning a shared library counts as having joined it.
    expect(legadoJoinedLibraryIds(ownerId)).toEqual([privateLibraryId, sharedLibraryId, publicLibraryId])
    // A member of one library never gets a sibling they never joined, public or not.
    expect(legadoJoinedLibraryIds(memberId)).toEqual([legadoPrivateLibraryId(memberId), sharedLibraryId])
  })

  it('omits a library with no readable work instead of rendering dead buttons', async () => {
    seedCategory(privateLibraryId, ownerId, '网络小说')
    seedWork(sharedLibraryId, ownerId)

    const config = await getLegadoExploreConfig(memberId)

    expect(config.libraries.map((library) => library.id)).toEqual([sharedLibraryId])
  })

  it('rejects a taxonomy id that belongs to another library', () => {
    const sharedCategory = seedCategory(sharedLibraryId, ownerId, '共享分类')
    const privateCategory = seedCategory(privateLibraryId, ownerId, '私有分类')
    const privateTag = seedTag(privateLibraryId, ownerId, '私有标签')

    // Ids are library-local, so one library's row must not answer for another.
    expect(getLegadoExploreFilter(ownerId, privateLibraryId, 'shelf', privateCategory))
      .toEqual({ libraryId: privateLibraryId, categoryId: privateCategory })
    expect(() => getLegadoExploreFilter(ownerId, privateLibraryId, 'shelf', sharedCategory)).toThrow()
    expect(() => getLegadoExploreFilter(ownerId, sharedLibraryId, 'tag', privateTag)).toThrow()
    // The uncategorized sentinel exists once per library, so it always resolves.
    expect(getLegadoExploreFilter(ownerId, sharedLibraryId, 'shelf', 'none')).toEqual({ libraryId: sharedLibraryId, categoryId: 'none' })
    expect(getLegadoExploreFilter(ownerId, sharedLibraryId, 'all')).toEqual({ libraryId: sharedLibraryId })
    expect(() => getLegadoExploreFilter(ownerId, sharedLibraryId, 'tag')).toThrow()
  })

  it('reads the latest non-volume chapter title for a whole page at once', () => {
    const { versionId } = seedWork(privateLibraryId, ownerId)
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: versionId, revisionNo: 2, blobKey: 'blobs/aa/c.epub',
      size: 10, chapterCount: 3, meta: {
        // A volume node has no chapter behind it, so the last content chapter wins.
        chapters: [
          { id: 'c0', title: '第一卷', level: 1 },
          { id: 'c1', title: '第一章', level: 2 },
          { id: 'c2', title: '第二章', level: 2 },
        ],
      }, createdAt: 2,
    }).run()

    expect(legadoLatestChapterTitles([versionId]).get(versionId)).toBe('第二章')
    expect(legadoLatestChapterTitles([]).size).toBe(0)
    expect(legadoLatestChapterTitles(['missing']).size).toBe(0)
  })

  it('renders chapter dates in the reader\'s own zone, not the server\'s', async () => {
    const { versionId } = seedWork(privateLibraryId, ownerId)
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: versionId, revisionNo: 2, blobKey: 'blobs/aa/c.epub',
      size: 10, chapterCount: 1, meta: {
        chapters: [{ id: 'c0', title: '第一章', level: 1, startOffset: 0, endOffset: 10 }],
      },
      // 16:30Z is already the next day in Shanghai and still the previous
      // evening in New York, so the zone decides the answer, not the instant.
      createdAt: Date.UTC(2026, 8, 30, 16, 30),
    }).run()

    expect((await getLegadoToc(ownerId, versionId)).map((c) => c.contentUpdateDate)).toEqual(['2026-09-30 16:30'])

    updateTimezone(ownerId, 'Asia/Shanghai')
    expect((await getLegadoToc(ownerId, versionId)).map((c) => c.contentUpdateDate)).toEqual(['2026-10-01 00:30'])

    updateTimezone(ownerId, 'America/New_York')
    expect((await getLegadoToc(ownerId, versionId)).map((c) => c.contentUpdateDate)).toEqual(['2026-09-30 12:30'])
  })

  it('dates every chapter from the revision the TOC was built from', async () => {
    const { workId, versionId } = seedWork(privateLibraryId, ownerId)
    // A chapter with no addedAt reads as the revision it lives in; one with an
    // addedAt keeps its own date, which is what an already-appended prefix
    // looks like next to the tail that arrived with the newest revision.
    const chapters = [
      { id: 'c0', title: '第一章', level: 1, startOffset: 0, endOffset: 10, addedAt: Date.UTC(2020, 0, 5) },
      { id: 'c1', title: '第二章', level: 1, startOffset: 10, endOffset: 20 },
    ]
    const pinned = createId('rev')
    db.insert(schema.contentRevisions).values([
      { id: pinned, bookVersionId: versionId, revisionNo: 2, blobKey: 'blobs/aa/c.epub', size: 10, chapterCount: 2, meta: { chapters }, createdAt: Date.UTC(2026, 8, 30, 23, 30) },
      { id: createId('rev'), bookVersionId: versionId, revisionNo: 3, blobKey: 'blobs/aa/d.epub', size: 10, chapterCount: 2, meta: { chapters }, createdAt: Date.UTC(2026, 9, 2, 1, 0) },
    ]).run()

    // Legado prints TocRule.updateTime verbatim beside each chapter title, so
    // this is a readable date. It comes from the revision rather than the work
    // so a metadata edit does not restamp the whole TOC.
    const toc = await getLegadoToc(ownerId, versionId)
    expect(toc.map((chapter) => [chapter.title, chapter.contentUpdateDate])).toEqual([
      ['第一章', '2020-01-05 00:00'],
      ['第二章', '2026-10-02 01:00'],
    ])

    // A pinned card reads the revision it pinned, not the newest one, so the
    // date has to follow the pin or the TOC would claim a freshness the reader
    // is not getting. Only a collected (shared) card can be pinned, which needs
    // the source link the read gate verifies against.
    const link = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, versionId)).get()!
    const sourceLinkId = createId('lbv')
    db.insert(schema.libraryBookVersions).values({
      id: sourceLinkId, libraryId: sharedLibraryId, libraryBookId: workId, bookVersionId: versionId,
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    db.update(schema.libraryBookVersions)
      .set({
        kind: 'shared',
        sourceLibraryId: sharedLibraryId,
        sourceLibraryBookVersionId: sourceLinkId,
        pinnedRevisionId: pinned,
      })
      .where(eq(schema.libraryBookVersions.id, link.id)).run()

    const pinnedToc = await getLegadoToc(ownerId, versionId)
    expect(pinnedToc.map((chapter) => [chapter.title, chapter.contentUpdateDate])).toEqual([
      ['第一章', '2020-01-05 00:00'],
      ['第二章', '2026-09-30 23:30'],
    ])
  })
})
