import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReaderManifest } from '@bookdock/shared'

import { idbChapterTextStore } from '../idb-chapter-store'
import { resetSessionScope, setSessionAccount } from '@/lib/session-scope'
import { extractReaderManifestToc, prepareRevisionNavigation, resolveRevisionNavigationTarget, revisionTargetEntryPath } from '../revision-navigation'

const oldManifest: ReaderManifest = {
  formatVersion: 1,
  bookId: 'book-1', revisionId: 'rev-1', contentHash: 'hash-1', size: 100, entryCount: 2,
  entries: [],
  spine: [{ path: 'Text/one.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
  startupFiles: [], opfPath: 'content.opf', navPath: null, ncxPath: null, generated: false,
}

afterEach(() => {
  resetSessionScope()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reader revision navigation', () => {
  it('keeps an exact location only when the source content hash is unchanged', () => {
    const latest = { ...oldManifest, revisionId: 'rev-2' }
    expect(resolveRevisionNavigationTarget(oldManifest, latest, {
      target: 'epubcfi(/6/2!/4/2)', chapterNavigation: false,
    })).toBe('epubcfi(/6/2!/4/2)')
  })

  it('maps a chapter navigation by exact spine href and never by index or label', () => {
    const latest = {
      ...oldManifest, revisionId: 'rev-2', contentHash: 'hash-2',
      spine: [
        { path: 'Text/new.xhtml', mediaType: 'application/xhtml+xml', linear: true },
        { path: 'Text/one.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      ],
    }
    expect(resolveRevisionNavigationTarget(oldManifest, latest, {
      sectionHref: 'Text/one.xhtml', chapterNavigation: true,
    })).toBe('Text/one.xhtml')
    expect(resolveRevisionNavigationTarget(oldManifest, latest, {
      sectionHref: 'Text/removed.xhtml', chapterNavigation: true,
    })).toBeNull()
    expect(resolveRevisionNavigationTarget(oldManifest, latest, {
      target: 'epubcfi(/6/2!/4/2)', sectionHref: 'Text/one.xhtml', chapterNavigation: false,
    })).toBeNull()
  })

  it('does not treat ordinal TXT EPUB hrefs as chapter identity after content changes', () => {
    const previous = { ...oldManifest, generated: true, spine: [
      { path: 'chapter-0001.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      { path: 'chapter-0002.xhtml', mediaType: 'application/xhtml+xml', linear: true },
    ] }
    const latest = { ...previous, revisionId: 'rev-2', contentHash: 'hash-2', spine: [
      { path: 'chapter-0001.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      { path: 'chapter-0002.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      { path: 'chapter-0003.xhtml', mediaType: 'application/xhtml+xml', linear: true },
    ] }
    expect(resolveRevisionNavigationTarget(previous, latest, {
      target: 'chapter-0002.xhtml', sectionHref: 'chapter-0002.xhtml', chapterNavigation: true,
    })).toBeNull()
  })

  it('loads a generated TXT chapter when the user explicitly selects it from the latest TOC', async () => {
    setSessionAccount('reader-test')
    const previous = {
      ...oldManifest,
      generated: true,
      spine: [{ path: 'chapter-0001.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
    }
    const latest: ReaderManifest = {
      ...previous,
      revisionId: 'rev-2',
      contentHash: 'hash-2',
      entries: [{ path: 'chapter-0002.xhtml', size: 30, compressedSize: 20, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
      spine: [{ path: 'chapter-0002.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
    }
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/reader/manifest')
      ? new Response(JSON.stringify({ data: latest }), { status: 200 })
      : new Response('<html><body>selected latest chapter</body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })))

    const intent = { target: 'chapter-0002.xhtml', sectionHref: 'chapter-0002.xhtml', chapterNavigation: true }
    await expect(prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', previous, intent, new AbortController().signal))
      .resolves.toMatchObject({ target: null, toc: [] })
    const prepared = await prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', previous, {
      ...intent,
      explicitRevisionId: 'rev-2',
    }, new AbortController().signal)

    expect(prepared.target).toBe('chapter-0002.xhtml')
    expect(prepared.targetPath).toBe('chapter-0002.xhtml')
    expect(prepared.targetText).toContain('selected latest chapter')
  })

  it('refreshes the latest TOC when an explicit selection belongs to a superseded revision', async () => {
    setSessionAccount('reader-test')
    const latest: ReaderManifest = {
      ...oldManifest,
      revisionId: 'rev-3',
      navPath: 'EPUB/nav.xhtml',
      startupFiles: [{ path: 'EPUB/nav.xhtml', text: '<nav epub:type="toc"><ol><li><a href="new.xhtml">Newest</a></li></ol></nav>' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: latest }), { status: 200 })))
    const prepared = await prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', oldManifest, {
      target: 'Text/one.xhtml',
      sectionHref: 'Text/one.xhtml',
      chapterNavigation: true,
      explicitRevisionId: 'rev-2',
    }, new AbortController().signal)
    expect(prepared.latest.manifest.revisionId).toBe('rev-3')
    expect(prepared.target).toBeNull()
    expect(prepared.toc).toEqual([{ label: 'Newest', href: 'EPUB/new.xhtml' }])
  })

  it('extracts the current EPUB navigation labels and exact hrefs from startup files', () => {
    const manifest = {
      ...oldManifest,
      navPath: 'EPUB/nav.xhtml',
      startupFiles: [{ path: 'EPUB/nav.xhtml', text: '<nav epub:type="toc"><ol><li><a href="Text/one.xhtml#part">Chapter One</a></li></ol></nav>' }],
    }
    expect(extractReaderManifestToc(manifest)).toEqual([{ label: 'Chapter One', href: 'EPUB/Text/one.xhtml#part' }])
  })

  it('refreshes without the stale revision and prepares the exact target before returning it', async () => {
    setSessionAccount('reader-test')
    const latest: ReaderManifest = {
      ...oldManifest,
      revisionId: 'rev-2',
      entries: [{ path: 'Text/one.xhtml', size: 30, compressedSize: 20, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
      spine: [{ path: 'Text/one.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
    }
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: latest }), { status: 200 })
      return new Response('<html><body><p id="part">latest</p></body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
    }))

    const prepared = await prepareRevisionNavigation('/api/v1/books/book-1/file?reader=1&revisionId=rev-1&v=4', oldManifest, {
      target: 'Text/one.xhtml#part', sectionHref: 'Text/one.xhtml', chapterNavigation: true,
    }, new AbortController().signal)

    expect(prepared.target).toBe('Text/one.xhtml#part')
    expect(prepared.targetPath).toBe('Text/one.xhtml')
    expect(prepared.targetText).toContain('id="part"')
    expect(urls[0]).not.toContain('revisionId=rev-1')
    expect(urls[1]).toContain('revisionId=rev-2')
  })

  it('returns the latest TOC when the target cannot be matched without guessing', async () => {
    setSessionAccount('reader-test')
    const latest: ReaderManifest = {
      ...oldManifest,
      revisionId: 'rev-2',
      contentHash: 'hash-2',
      navPath: 'EPUB/nav.xhtml',
      startupFiles: [{ path: 'EPUB/nav.xhtml', text: '<nav epub:type="toc"><ol><li><a href="new.xhtml">New chapter</a></li></ol></nav>' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: latest }), { status: 200 })))
    const prepared = await prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', oldManifest, {
      target: 'epubcfi(/6/2!/4/2)', sectionHref: 'Text/removed.xhtml', chapterNavigation: false,
    }, new AbortController().signal)
    expect(prepared.target).toBeNull()
    expect(prepared.toc).toEqual([{ label: 'New chapter', href: 'EPUB/new.xhtml' }])
  })

  it('rechecks the manifest when content changes again during target preparation', async () => {
    setSessionAccount('reader-test')
    const rev2: ReaderManifest = {
      ...oldManifest, revisionId: 'rev-2', contentHash: 'hash-2',
      entries: [{ path: 'Text/one.xhtml', size: 30, compressedSize: 20, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
    }
    const rev3 = { ...rev2, revisionId: 'rev-3' }
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let manifestCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/reader/manifest')) {
        manifestCalls += 1
        return new Response(JSON.stringify({ data: manifestCalls === 1 ? rev2 : rev3 }), { status: 200 })
      }
      if (manifestCalls === 1) return new Response(JSON.stringify({ error: { code: 'READER_REVISION_CHANGED' } }), { status: 409 })
      return new Response('<html><body>updated</body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
    }))
    const intent = { target: 'Text/one.xhtml', sectionHref: 'Text/one.xhtml', chapterNavigation: true }

    const prepared = await prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', oldManifest, intent, new AbortController().signal)
    expect(prepared.latest.manifest.revisionId).toBe('rev-3')
    expect(prepared.target).toBe('Text/one.xhtml')
    expect(manifestCalls).toBe(2)
  })

  it('keeps preparation errors classified and never treats them as a range fallback', async () => {
    setSessionAccount('reader-test')
    const latest: ReaderManifest = {
      ...oldManifest, revisionId: 'rev-2', contentHash: 'hash-2',
      entries: [{ path: 'Text/one.xhtml', size: 30, compressedSize: 20, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
    }
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/reader/manifest')
      ? new Response(JSON.stringify({ data: latest }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'READER_ENTRY_FAILED', message: 'damaged' } }), { status: 500 })))

    await expect(prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', oldManifest, {
      target: 'Text/one.xhtml', sectionHref: 'Text/one.xhtml', chapterNavigation: true,
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'READER_ENTRY_FAILED' })
  })

  it('uses the section href for search and CFI targets and preserves per-navigation cancellation', async () => {
    expect(revisionTargetEntryPath('search-hit:1:2', 'Text/one.xhtml')).toBe('Text/one.xhtml')
    expect(revisionTargetEntryPath('epubcfi(/6/2!/4/2)', 'Text/one.xhtml#part')).toBe('Text/one.xhtml')
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? null
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })))
    const first = prepareRevisionNavigation('/api/v1/books/book-1/file?revisionId=rev-1', oldManifest, {
      target: 'Text/one.xhtml', sectionHref: 'Text/one.xhtml', chapterNavigation: true,
    }, controller.signal)
    await vi.waitFor(() => expect(requestSignal).not.toBeNull())
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
  })
})
