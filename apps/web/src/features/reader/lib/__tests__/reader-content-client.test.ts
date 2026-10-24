import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReaderManifest } from '@bookdock/shared'

import {
  canFallbackReaderContent,
  clearPreparedReaderContentText,
  consumePreparedReaderContentText,
  fetchReaderManifest,
  primeReaderContentText,
  ReaderContentError,
  ReaderContentSession,
} from '../reader-content-client'
import { idbChapterTextStore } from '../idb-chapter-store'
import {
  getContentAccountScope,
  getSessionEpoch,
  ReaderSessionChangedError,
  resetSessionScope,
  setSessionAccount,
} from '@/lib/session-scope'

const manifest: ReaderManifest = {
  formatVersion: 1,
  bookId: 'b1',
  revisionId: 'rev-1',
  contentHash: 'hash',
  size: 100,
  entryCount: 2,
  entries: [
    { path: 'OEBPS/text/ch1.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' },
    { path: 'OEBPS/img.png', size: 4, compressedSize: 4, compression: 'store', mediaType: 'image/png' },
  ],
  spine: [{ path: 'OEBPS/text/ch1.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
  startupFiles: [{ path: 'META-INF/container.xml', text: '<container/>' }],
  opfPath: 'OEBPS/content.opf',
  navPath: null,
  ncxPath: null,
  generated: false,
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function manifestFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/reader/manifest')) return jsonResponse({ data: manifest })
    if (url.includes('/reader/entry')) {
      return new Response('<html><body>甲</body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml; charset=utf-8' } })
    }
    return jsonResponse({ error: { code: 'READER_ENTRY_NOT_FOUND', message: 'missing' } }, 404)
  })
}

afterEach(() => {
  resetSessionScope()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reader content client', () => {
  function manifestWithTextEntries(entries: Array<{ path: string; size: number }>): ReaderManifest {
    return {
      ...manifest,
      entries: entries.map(({ path, size }) => ({
        path,
        size,
        compressedSize: Math.min(size, 1024),
        compression: 'deflate',
        mediaType: 'application/xhtml+xml',
      })),
    }
  }

  it('requests the manifest from the revision-bearing content URL and reuses session memory', async () => {
    setSessionAccount('user-a')
    const fetchMock = manifestFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { manifest: fetched, accountScope, epoch } = await fetchReaderManifest(
      '/api/v1/books/b1/file?reader=1&revisionId=rev-1&v=42&showHidden=1',
    )
    expect(fetched.revisionId).toBe('rev-1')
    expect(accountScope).toBe('u:user-a')
    const firstUrl = String(fetchMock.mock.calls[0]![0])
    expect(firstUrl).toContain('/api/v1/books/b1/reader/manifest?')
    expect(firstUrl).toContain('revisionId=rev-1')
    expect(firstUrl).toContain('showHidden=1')

    const session = new ReaderContentSession(fetched, accountScope, epoch, '/api/v1/books/b1/file?reader=1&revisionId=rev-1')
    expect(await session.loadText('META-INF/container.xml')).toBe('<container/>')
    expect(await session.loadText('OEBPS/text/ch1.xhtml')).toContain('甲')
    expect(await session.loadText('OEBPS/text/ch1.xhtml')).toContain('甲')
    const entryCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/reader/entry'))
    expect(entryCalls).toHaveLength(1)
    session.destroy()
  })

  it('accepts chapter markup and image dimensions together without a second metadata request', async () => {
    setSessionAccount('user-a')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/reader/entry')) {
        return jsonResponse({ data: {
          text: '<html><body><img src="../img.png" width="64" height="32"/></body></html>',
          resources: [{ path: 'OEBPS/img.png', width: 64, height: 32 }],
        } })
      }
      return jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    const text = await session.loadText('OEBPS/text/ch1.xhtml')

    expect(text).toContain('width="64" height="32"')
    expect(fetchMock.mock.calls).toHaveLength(1)
    session.destroy()
  })

  it('retries once when a successful response body fails during transfer', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let attempts = 0
    const fetchMock = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection reset')) } }), {
          status: 200,
          headers: { 'Content-Type': 'application/xhtml+xml' },
        })
      }
      return new Response('<html>retried body</html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    await expect(session.loadText('OEBPS/text/ch1.xhtml')).resolves.toBe('<html>retried body</html>')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    session.destroy()
  })

  it('cancels one shared request consumer without interrupting another', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let release!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const controller = new AbortController()
    const cancelled = session.loadText('OEBPS/text/ch1.xhtml', 'search', controller.signal)
    const retained = session.loadText('OEBPS/text/ch1.xhtml')
    controller.abort()

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    release(new Response('<p>shared</p>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } }))
    await expect(retained).resolves.toBe('<p>shared</p>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    session.destroy()
  })

  it('aborts an in-flight request when its final consumer cancels', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise<Response>((_, reject) => requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const controller = new AbortController()
    const loading = session.loadText('OEBPS/text/ch1.xhtml', 'foreground', controller.signal)
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    controller.abort()

    await rejected
    expect(requestSignal?.aborted).toBe(true)
    session.destroy()
  })

  it('removes a queued request when its only consumer cancels', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 7 }, (_, index) => `OEBPS/text/queued-${index}.xhtml`)
    const releases: Array<(response: Response) => void> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { releases.push(resolve) }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const active = paths.slice(0, 6).map((path) => session.loadText(path))
    const controller = new AbortController()
    const queued = session.loadText(paths[6]!, 'foreground', controller.signal)
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    controller.abort()
    await rejected
    for (const release of releases) release(new Response('<p>active</p>', { status: 200 }))
    await Promise.all(active)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    session.destroy()
  })

  it('records a background revision change, notifies the view, and stops later prefetch', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const testManifest = manifestWithTextEntries([{ path: 'OEBPS/text/ch1.xhtml', size: 20 }])
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'READER_REVISION_CHANGED', message: 'changed' } }, 409))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-1')
    const changed = vi.fn()
    session.onRevisionChanged(changed)
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await vi.waitFor(() => expect(session.hasRevisionChanged).toBe(true))

    expect(changed).toHaveBeenCalledWith('rev-1')
    const requestCount = fetchMock.mock.calls.length
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(requestCount)
    session.destroy()
  })

  it('does not start queued requests after the content session is destroyed', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 7 }, (_, index) => `OEBPS/text/queued-${index}.xhtml`)
    const testManifest: ReaderManifest = {
      ...manifest,
      entries: paths.map((path) => ({ path, size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' })),
      spine: paths.map((path) => ({ path, mediaType: 'application/xhtml+xml', linear: true })),
    }
    const releases: Array<(response: Response) => void> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { releases.push(resolve) }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const loads = paths.map((path) => session.loadText(path))
    const settledLoads = Promise.allSettled(loads)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(6)
    session.destroy()
    for (const release of releases) release(new Response('<p>late response</p>', { status: 200 }))
    const results = await settledLoads

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
  })

  it('does not retry after the session is destroyed during retry backoff', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let failRequest!: (error: TypeError) => void
    const fetchMock = vi.fn(() => new Promise<Response>((_, reject) => { failRequest = reject }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    vi.useFakeTimers()
    try {
      const loading = session.loadText('OEBPS/text/ch1.xhtml')
      const rejected = expect(loading).rejects.toBeDefined()
      for (let index = 0; index < 10 && fetchMock.mock.calls.length === 0; index += 1) await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      failRequest(new TypeError('connection reset'))
      await Promise.resolve()
      await Promise.resolve()
      session.destroy()
      await vi.advanceTimersByTimeAsync(100)

      await rejected
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      session.destroy()
      vi.useRealTimers()
    }
  })

  it('repairs legacy IndexedDB entries that cached the markup JSON envelope as chapter text', async () => {
    setSessionAccount('user-a')
    const markup = '<html><body><h1>第九章</h1><p>正文</p></body></html>'
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue({
      key: 'legacy-key',
      text: JSON.stringify({ data: { text: markup, resources: [] } }),
    })
    const put = vi.spyOn(idbChapterTextStore, 'put').mockResolvedValue()
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'cache should satisfy the read' } }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    await expect(session.loadText('OEBPS/text/ch1.xhtml')).resolves.toBe(markup)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(
      `${session.textNamespace}|OEBPS/text/ch1.xhtml`,
      markup,
      expect.any(Function),
    )
    session.destroy()
  })

  it('refetches derived markup instead of reusing a legacy fixed-height chapter', async () => {
    setSessionAccount('user-a')
    const path = 'OEBPS/text/ch1.xhtml'
    const legacyKey = `u:user-a|b1|rev-1|v1|${path}`
    const legacyText = '<html><body><img src="../img.png" width="20px" height="957"/></body></html>'
    const currentText = '<html><body><img src="../img.png" width="20px" style="aspect-ratio: 1080 / 957;"/></body></html>'
    const records = new Map([[legacyKey, legacyText]])
    const get = vi.spyOn(idbChapterTextStore, 'get').mockImplementation(async key => (
      records.has(key) ? { key, text: records.get(key)! } : undefined
    ))
    vi.spyOn(idbChapterTextStore, 'put').mockImplementation(async (key, text) => { records.set(key, text) })
    vi.spyOn(idbChapterTextStore, 'enforceBudget').mockResolvedValue(undefined)
    const fetchMock = vi.fn(async () => jsonResponse({ data: { text: currentText, resources: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    expect(await session.loadText(path)).toBe(currentText)
    expect(await session.loadText(path)).toBe(currentText)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(get).not.toHaveBeenCalledWith(legacyKey)
    expect(records.get(legacyKey)).toBe(legacyText)
    expect(records.get(`${session.textNamespace}|${path}`)).toBe(currentText)
    session.destroy()
  })

  it('ignores legacy derived markup during batch prefetch and shares the fresh result with navigation', async () => {
    setSessionAccount('user-a')
    const path = 'OEBPS/text/ch1.xhtml'
    const legacyKey = `u:user-a|b1|rev-1|v1|${path}`
    const legacyText = '<html><body><img width="20px" height="957"/></body></html>'
    const currentText = '<html><body><img width="20px" style="aspect-ratio: 1080 / 957;"/></body></html>'
    const get = vi.spyOn(idbChapterTextStore, 'get').mockImplementation(async key => (
      key === legacyKey ? { key, text: legacyText } : undefined
    ))
    const put = vi.spyOn(idbChapterTextStore, 'put').mockResolvedValue(undefined)
    vi.spyOn(idbChapterTextStore, 'enforceBudget').mockResolvedValue(undefined)
    const fetchMock = vi.fn(async () => jsonResponse({ data: {
      revisionId: 'rev-1', items: [{ path, text: currentText, bytes: currentText.length }],
    } }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTexts([path])
    await vi.waitFor(() => expect(put).toHaveBeenCalled())
    expect(await session.loadText(path)).toBe(currentText)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(get).not.toHaveBeenCalledWith(legacyKey)
    expect(put).toHaveBeenCalledWith(`${session.textNamespace}|${path}`, currentText, expect.any(Function))
    session.destroy()
  })

  it('uses chapter layout hints to prefetch only the first small image within a bounded budget', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reader/texts')) {
        return jsonResponse({ data: { revisionId: 'rev-1', items: [{
          path: 'OEBPS/text/ch1.xhtml',
          text: '<html><body><img src="../img.png" width="64" height="32"/></body></html>',
          bytes: 80,
          resources: [{ path: 'OEBPS/img.png', width: 64, height: 32 }],
        }] } })
      }
      if (url.includes('/reader/entry')) return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'image/png' } })
      return jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 30))

    const imageRequests = fetchMock.mock.calls.filter(([input]) => {
      const url = String(input)
      return url.includes('/reader/entry') && new URL(url, 'http://localhost').searchParams.get('path') === 'OEBPS/img.png'
    })
    expect(imageRequests).toHaveLength(1)
    session.destroy()
  })

  it('does not send a later window batch for a chapter already requested in the foreground', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const [chapterA, chapterB] = ['OEBPS/text/a.xhtml', 'OEBPS/text/b.xhtml']
    const testManifest = manifestWithTextEntries([chapterA, chapterB].map(path => ({ path, size: 24 * 1024 })))
    let releaseA!: (response: Response) => void
    let releaseB!: (response: Response) => void
    const responseA = new Promise<Response>(resolve => { releaseA = resolve })
    const responseB = new Promise<Response>(resolve => { releaseB = resolve })
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reader/texts')) {
        const paths = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
        requests.push(paths)
        return paths.includes(chapterA) ? responseA : Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterB, text: '<p>batch B</p>', bytes: 12 }] } }))
      }
      requests.push([new URL(String(input), 'http://localhost').searchParams.get('path')!])
      return responseB
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow([chapterA, chapterB])
    await vi.waitFor(() => expect(requests).toEqual([[chapterA]]))
    const foregroundB = session.loadText(chapterB)
    await vi.waitFor(() => expect(requests).toEqual([[chapterA], [chapterB]]))
    releaseA(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterA, text: '<p>A</p>', bytes: 8 }] } }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requests).toEqual([[chapterA], [chapterB]])
    releaseB(new Response('<p>B</p>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } }))
    await expect(foregroundB).resolves.toContain('B')
    session.destroy()
  })

  it('counts a foreground chapter completed before the first window request as covered', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const [chapterA, chapterB] = ['OEBPS/text/a.xhtml', 'OEBPS/text/b.xhtml']
    const testManifest = manifestWithTextEntries([chapterA, chapterB].map(path => ({ path, size: 24 * 1024 })))
    let releaseA!: (response: Response) => void
    const responseA = new Promise<Response>(resolve => { releaseA = resolve })
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reader/texts')) {
        const paths = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
        requests.push(paths)
        return paths.includes(chapterA) ? responseA : Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [] } }))
      }
      const path = new URL(String(input), 'http://localhost').searchParams.get('path')!
      requests.push([path])
      return Promise.resolve(new Response('<p>B</p>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } }))
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    session.prefetchTextWindow([chapterA, chapterB])
    await vi.waitFor(() => expect(requests).toEqual([[chapterA]]))
    await expect(session.loadText(chapterB)).resolves.toContain('B')
    releaseA(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterA, text: '<p>A</p>', bytes: 8 }] } }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requests).toEqual([[chapterA], [chapterB]])
    session.destroy()
  })

  it('retries a foreground chapter in the residual batch after its request fails', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const [chapterA, chapterB] = ['OEBPS/text/a.xhtml', 'OEBPS/text/b.xhtml']
    const testManifest = manifestWithTextEntries([chapterA, chapterB].map(path => ({ path, size: 24 * 1024 })))
    let releaseA!: (response: Response) => void
    let releaseB!: (response: Response) => void
    const responseA = new Promise<Response>(resolve => { releaseA = resolve })
    const responseB = new Promise<Response>(resolve => { releaseB = resolve })
    const requests: Array<{ path: string[]; batch: boolean }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reader/texts')) {
        const paths = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
        requests.push({ path: paths, batch: true })
        return paths.includes(chapterA) ? responseA : Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterB, text: '<p>batch recovery</p>', bytes: 20 }] } }))
      }
      const path = new URL(String(input), 'http://localhost').searchParams.get('path')!
      requests.push({ path: [path], batch: false })
      return responseB
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    session.prefetchTextWindow([chapterA, chapterB])
    await vi.waitFor(() => expect(requests.map(request => request.path)).toEqual([[chapterA]]))
    const foregroundB = session.loadText(chapterB)
    await vi.waitFor(() => expect(requests.map(request => request.path)).toEqual([[chapterA], [chapterB]]))
    releaseA(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterA, text: '<p>A</p>', bytes: 8 }] } }))
    releaseB(jsonResponse({ error: { code: 'READER_ENTRY_NOT_FOUND', message: 'missing' } }, 404))
    await expect(foregroundB).resolves.toBeNull()
    await vi.waitFor(() => expect(requests).toEqual([
      { path: [chapterA], batch: true },
      { path: [chapterB], batch: false },
      { path: [chapterB], batch: true },
    ]))
    session.destroy()
  })

  it('cancels a residual-window wait and rechecks coverage after foreground work settles', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const [chapterA, chapterB, chapterC] = ['OEBPS/text/a.xhtml', 'OEBPS/text/b.xhtml', 'OEBPS/text/c.xhtml']
    const testManifest = manifestWithTextEntries([chapterA, chapterB, chapterC].map(path => ({ path, size: 24 * 1024 })))
    let releaseA!: (response: Response) => void
    let releaseB!: (response: Response) => void
    const responseA = new Promise<Response>(resolve => { releaseA = resolve })
    const responseB = new Promise<Response>(resolve => { releaseB = resolve })
    const requests: string[][] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/reader/texts')) {
        requests.push([new URL(String(input), 'http://localhost').searchParams.get('path')!])
        return responseB
      }
      const paths = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      requests.push(paths)
      if (paths.includes(chapterA)) return responseA
      return Promise.resolve(jsonResponse({ data: {
        revisionId: testManifest.revisionId,
        items: paths.map(path => ({ path, text: `<p>${path}</p>`, bytes: 20 })),
      } }))
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow([chapterA, chapterB, chapterC])
    await vi.waitFor(() => expect(requests).toEqual([[chapterA]]))
    const foregroundB = session.loadText(chapterB)
    await vi.waitFor(() => expect(requests).toEqual([[chapterA], [chapterB]]))
    releaseA(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: chapterA, text: '<p>A</p>', bytes: 8 }] } }))
    await new Promise(resolve => setTimeout(resolve, 0))
    session.prefetchTextWindow([chapterC])
    await vi.waitFor(() => expect(requests).toEqual([[chapterA], [chapterB], [chapterC]]))
    releaseB(new Response('<p>B</p>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } }))
    await expect(foregroundB).resolves.toContain('B')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requests).toEqual([[chapterA], [chapterB], [chapterC]])
    session.destroy()
  })

  it('keeps resource prefetch within the active clean-reading policy', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const dimensionRequests: boolean[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reader/texts')) {
        dimensionRequests.push((JSON.parse(String(init?.body)) as { includeResourceDimensions: boolean }).includeResourceDimensions)
        return jsonResponse({ data: { revisionId: 'rev-1', items: [{ path: 'OEBPS/text/ch1.xhtml', text: '<p>text</p>', bytes: 10, resources: [{ path: 'OEBPS/img.png', width: 2, height: 2 }] }] } })
      }
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const testManifest = manifestWithTextEntries([
      { path: 'OEBPS/text/ch1.xhtml', size: 100 },
      { path: 'OEBPS/text/ch2.xhtml', size: 100 },
    ])
    testManifest.entries.push({ path: 'OEBPS/img.png', size: 4, compressedSize: 4, compression: 0, mediaType: 'image/png' })
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    session.setResourcePrefetchFilter(() => true)
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/reader/entry'))).toBe(false)
    session.setResourcePrefetchFilter(null)
    session.prefetchTextWindow(['OEBPS/text/ch2.xhtml'])
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/reader/entry'))).toBe(true)
    expect(dimensionRequests).toEqual([false, true])
    session.destroy()
  })

  it('requests XHTML without image dimensions in clean reading', async () => {
    setSessionAccount('user-a')
    const fetchMock = vi.fn(async () => jsonResponse({ data: { text: '<html><body>clean</body></html>', resources: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1', true)
    await expect(session.loadText('OEBPS/text/ch1.xhtml')).resolves.toContain('clean')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('includeResourceDimensions=false')
    expect(session.textNamespace).toContain('no-resource-dimensions')
    session.destroy()
  })

  it('cancels an obsolete media prefetch consumer without aborting a foreground reader', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const testManifest = manifestWithTextEntries([{ path: 'OEBPS/text/ch1.xhtml', size: 100 }])
    testManifest.entries.push({ path: 'OEBPS/img.png', size: 4, compressedSize: 4, compression: 0, mediaType: 'image/png' })
    let releaseImage!: (response: Response) => void
    const imageResponse = new Promise<Response>(resolve => { releaseImage = resolve })
    let backgroundSignal: AbortSignal | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/reader/texts')) return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{
        path: 'OEBPS/text/ch1.xhtml', text: '<p>text</p>', bytes: 10, resources: [{ path: 'OEBPS/img.png', width: 2, height: 2 }],
      }] } }))
      backgroundSignal = init?.signal as AbortSignal
      return imageResponse
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/reader/entry'))).toBe(true))
    const foregroundImage = session.loadBlob('OEBPS/img.png', 'image/png')
    await new Promise(resolve => setTimeout(resolve, 0))
    session.setResourcePrefetchFilter(() => true)
    expect((session as any).resourcePrefetchConsumers.get('OEBPS/img.png').signal.aborted).toBe(true)
    expect(backgroundSignal?.aborted).toBe(false)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/reader/entry'))).toHaveLength(1)
    releaseImage(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } }))
    await expect(foregroundImage).resolves.toBeInstanceOf(Blob)
    session.destroy()
  })

  it('rejects stale responses after the viewing account changes', async () => {
    setSessionAccount('user-a')
    const put = vi.spyOn(idbChapterTextStore, 'put')
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-1')
    const loading = session.loadText('OEBPS/text/ch1.xhtml')
    await new Promise((resolve) => setTimeout(resolve, 0))
    setSessionAccount('user-b')
    release(new Response('<html>old</html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } }))
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(put).not.toHaveBeenCalled()
    session.destroy()
  })

  it('invalidates warm startup, text, and blob memory after a cross-tab account change', async () => {
    setSessionAccount('user-a')
    const fetchMock = manifestFetch()
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-1')
    await session.loadText('OEBPS/text/ch1.xhtml')
    await session.loadBlob('OEBPS/img.png')
    const requestsBeforeSwitch = fetchMock.mock.calls.length

    setSessionAccount('user-b')

    await expect(session.loadText('META-INF/container.xml')).rejects.toBeInstanceOf(ReaderSessionChangedError)
    await expect(session.loadText('OEBPS/text/ch1.xhtml')).rejects.toBeInstanceOf(ReaderSessionChangedError)
    await expect(session.loadBlob('OEBPS/img.png')).rejects.toBeInstanceOf(ReaderSessionChangedError)
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeSwitch)
    session.destroy()
  })

  it('does not duplicate an in-flight foreground entry in a later prefetch batch', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let release!: (response: Response) => void
    const entryResponse = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/reader/entry')) return entryResponse
      return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    const loading = session.loadText('OEBPS/text/ch1.xhtml')
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/reader/entry'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reader/texts'))).toBe(false)

    release(new Response('<html><body>前台正文</body></html>', { status: 200 }))
    await expect(loading).resolves.toContain('前台正文')
    session.destroy()
  })

  it('shares an active prefetch batch with a foreground request', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let release!: (response: Response) => void
    const batchResponse = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/reader/texts')) return batchResponse
      return Promise.resolve(new Response('<html>duplicate</html>', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const loading = session.loadText('OEBPS/text/ch1.xhtml')
    release(jsonResponse({ data: { revisionId: manifest.revisionId, items: [{ path: 'OEBPS/text/ch1.xhtml', text: '<html>批量正文</html>', bytes: 20 }] } }))

    await expect(loading).resolves.toContain('批量正文')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/reader/texts'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reader/entry'))).toBe(false)
    session.destroy()
  })

  it('uses one two-second deadline across both checks for an active batch waiter', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let release!: (response: Response) => void
    const batchResponse = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => String(input).includes('/reader/texts')
      ? batchResponse
      : Promise.resolve(new Response('<html>duplicate</html>', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))

    vi.useFakeTimers()
    const loading = session.loadText('OEBPS/text/ch1.xhtml')
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(loading).resolves.toBe('<html>duplicate</html>')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/reader/entry'))).toHaveLength(1)
    release(jsonResponse({ data: { revisionId: manifest.revisionId, items: [] } }))
    vi.useRealTimers()
    session.destroy()
  })

  it('releases a batch waiter as soon as its text reaches memory, before persistence completes', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    let finishWrite!: () => void
    vi.spyOn(idbChapterTextStore, 'put').mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    vi.spyOn(idbChapterTextStore, 'enforceBudget').mockImplementation(() => new Promise<void>(() => {}))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/reader/texts')
      ? jsonResponse({ data: { revisionId: manifest.revisionId, items: [{ path: 'OEBPS/text/ch1.xhtml', text: '<p>batch-ready</p>', bytes: 20 }] } })
      : jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(session.loadText('OEBPS/text/ch1.xhtml')).resolves.toBe('<p>batch-ready</p>')
    finishWrite()
    session.destroy()
  })

  it('stops all later reads after an explicit book access denial', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'BOOK_NOT_FOUND', message: 'not readable' } }, 404))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    await expect(session.loadText('OEBPS/text/ch1.xhtml')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const requestCount = fetchMock.mock.calls.length
    await expect(session.loadText('OEBPS/img.png')).rejects.toMatchObject({ code: 'BOOK_NOT_ACCESSIBLE' })
    await expect(session.loadBlob('OEBPS/img.png')).rejects.toMatchObject({ code: 'BOOK_NOT_ACCESSIBLE' })
    session.prefetchTexts(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(requestCount)
    session.destroy()
  })

  it('keeps the background prefetch slot independent from active search slots', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = ['OEBPS/text/search-1.xhtml', 'OEBPS/text/search-2.xhtml', 'OEBPS/text/next.xhtml']
    const testManifest: ReaderManifest = {
      ...manifest,
      entries: paths.map((path) => ({ path, size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' })),
    }
    const releases = new Map<string, (response: Response) => void>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/reader/entry')) {
        const path = new URL(url, 'http://localhost').searchParams.get('path')!
        return new Promise<Response>((resolve) => { releases.set(path, resolve) })
      }
      if (url.includes('/reader/texts')) {
        const body = JSON.parse(String(init?.body)) as { paths: string[] }
        return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: body.paths.map((path) => ({ path, text: `<p>${path}</p>`, bytes: 20 })) } }))
      }
      return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    const searching = paths.slice(0, 2).map((path) => session.loadText(path, 'search'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(releases.size).toBe(2)
    session.prefetchTexts([paths[2]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reader/texts'))).toBe(true)

    for (const path of paths.slice(0, 2)) releases.get(path)!(new Response(`<p>${path}</p>`, { status: 200 }))
    await Promise.all(searching)
    session.destroy()
  })

  it('starts an oversized search entry without charging beyond the fixed background byte budget', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const largePath = 'OEBPS/text/large-search.xhtml'
    const testManifest: ReaderManifest = {
      ...manifest,
      entries: [{ path: largePath, size: 9 * 1024 * 1024, compressedSize: 1, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
    }
    let release!: (response: Response) => void
    const entryResponse = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => String(input).includes('/reader/entry')
      ? entryResponse
      : Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500)))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    const loading = session.loadText(largePath, 'search')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reader/entry'))).toBe(true)
    release(new Response('<p>large search result</p>', { status: 200 }))
    await expect(loading).resolves.toContain('large search result')
    session.destroy()
  })

  it('holds background prefetch while paused and schedules again after resume', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const fetchMock = vi.fn(async () => jsonResponse({ data: { revisionId: manifest.revisionId, items: [{ path: 'OEBPS/text/ch1.xhtml', text: '<p>warm</p>', bytes: 20 }] } }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.pauseBackgroundPrefetch()
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    session.resumeBackgroundPrefetch()
    session.prefetchTextWindow(['OEBPS/text/ch1.xhtml'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    session.destroy()
  })

  it('cancels superseded queued prefetch windows while preserving foreground work', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 8 }, (_, index) => `OEBPS/text/ch${index + 1}.xhtml`)
    const testManifest: ReaderManifest = {
      ...manifest,
      entries: paths.map((path) => ({ path, size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' })),
    }
    const releases = new Map<string, (response: Response) => void>()
    const batches: string[][] = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/reader/entry')) {
        const path = new URL(url, 'http://localhost').searchParams.get('path')!
        return new Promise<Response>((resolve) => { releases.set(path, resolve) })
      }
      if (url.includes('/reader/texts')) {
        const body = JSON.parse(String(init?.body)) as { paths: string[] }
        batches.push(body.paths)
        return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: body.paths.map((path) => ({ path, text: `<p>${path}</p>`, bytes: 20 })) } }))
      }
      return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST', message: 'unexpected' } }, 500))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    const foreground = paths.slice(0, 6).map((path) => session.loadText(path))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(releases.size).toBe(6)
    session.prefetchTexts([paths[6]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.prefetchTexts([paths[7]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(batches).toEqual([])

    releases.get(paths[0]!)!(new Response('<p>前台继续</p>', { status: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(batches).toEqual([[paths[7]]])
    for (const path of paths.slice(1, 6)) releases.get(path)!(new Response(`<p>${path}</p>`, { status: 200 }))
    await Promise.all(foreground)
    session.destroy()
  })

  it('fills a 256 KiB window across batches and stops after 16 body files', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 20 }, (_, index) => `OEBPS/text/ch${index + 1}.xhtml`)
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 16 * 1024 })))
    const batches: string[][] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/reader/texts')) return jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500)
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: `<p>${path}</p>`, bytes: 10 })) } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths)
    await vi.waitFor(() => expect(batches).toHaveLength(3))

    expect(batches).toEqual([[paths[0]!], paths.slice(1, 9), paths.slice(9, 16)])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    session.destroy()
  })

  it('stops consuming the candidate iterable at the window byte boundary', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const next = 'OEBPS/text/window-limit.xhtml'
    const testManifest = manifestWithTextEntries([{ path: next, size: 256 * 1024 }])
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: next, text: '<p>ready</p>', bytes: 10 }] } })
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    function* candidates(): Generator<string> {
      yield next
      throw new Error('window consumed beyond byte boundary')
    }

    session.prefetchTextWindow(candidates())
    await vi.waitFor(() => expect(batches).toEqual([[next]]))
    session.destroy()
  })

  it('starts the nearest missing chapter request before checking a slow later cache entry', async () => {
    setSessionAccount('user-a')
    const [next, later] = ['OEBPS/text/next-cache-check.xhtml', 'OEBPS/text/later-cache-check.xhtml']
    const testManifest = manifestWithTextEntries([
      { path: next!, size: 24 * 1024 },
      { path: later!, size: 24 * 1024 },
    ])
    let releaseLaterCache!: (entry: undefined) => void
    const laterCache = new Promise<undefined>((resolve) => { releaseLaterCache = resolve })
    vi.spyOn(idbChapterTextStore, 'get').mockImplementation(key => (
      String(key).endsWith(later!) ? laterCache : Promise.resolve(undefined)
    ))
    let releaseNextResponse!: (response: Response) => void
    const nextResponse = new Promise<Response>((resolve) => { releaseNextResponse = resolve })
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return requested.includes(next!)
        ? nextResponse
        : Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: '<p>later</p>', bytes: 10 })) } }))
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow([next!, later!])
    await vi.waitFor(() => expect(batches).toEqual([[next!]]))
    releaseLaterCache(undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(batches).toEqual([[next!]])
    releaseNextResponse(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: next!, text: '<p>next</p>', bytes: 10 }] } }))
    await vi.waitFor(() => expect(batches).toEqual([[next!], [later!]]))
    session.destroy()
  })

  it('returns the nearest missing chapter before waiting for the rest of the window', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 5 }, (_, index) => `OEBPS/text/slow-${index}.xhtml`)
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 24 * 1024 })))
    let releaseDistant!: (response: Response) => void
    const distantResponse = new Promise<Response>((resolve) => { releaseDistant = resolve })
    const batches: string[][] = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      if (batches.length === 1) {
        return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: requested[0]!, text: '<p>next ready</p>', bytes: 10 }] } }))
      }
      return distantResponse
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths)
    await vi.waitFor(() => expect(batches).toHaveLength(2))
    await expect(session.loadText(paths[0]!)).resolves.toBe('<p>next ready</p>')
    expect(batches).toEqual([[paths[0]], paths.slice(1)])

    releaseDistant(jsonResponse({ data: { revisionId: testManifest.revisionId, items: paths.slice(1).map(path => ({ path, text: `<p>${path}</p>`, bytes: 10 })) } }))
    session.destroy()
  })

  it('shares the small-image budget and resource identity across window batches', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = Array.from({ length: 10 }, (_, index) => `OEBPS/text/image-${index}.xhtml`)
    const imagePaths = Array.from({ length: 10 }, (_, index) => `OEBPS/images/${index}.png`)
    const testManifest: ReaderManifest = {
      ...manifestWithTextEntries(paths.map(path => ({ path, size: 16 * 1024 }))),
      entries: [
        ...manifestWithTextEntries(paths.map(path => ({ path, size: 16 * 1024 }))).entries,
        ...imagePaths.map(path => ({ path, size: 128 * 1024, compressedSize: 64 * 1024, compression: 'deflate' as const, mediaType: 'image/png' })),
      ],
    }
    const batches: string[][] = []
    const imageRequests: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/reader/texts')) {
        const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
        batches.push(requested)
        return jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => {
          const index = paths.indexOf(path)
          const imageIndex = index === 8 ? 0 : index
          return { path, text: `<p>${path}</p>`, bytes: 10, resources: [{ path: imagePaths[imageIndex], width: 20, height: 10 }] }
        }) } })
      }
      if (url.includes('/reader/entry')) {
        imageRequests.push(new URL(url, 'http://localhost').searchParams.get('path')!)
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      return jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths)
    await vi.waitFor(() => expect(batches).toHaveLength(3))
    await vi.waitFor(() => expect(imageRequests).toHaveLength(4))

    expect(batches).toEqual([[paths[0]], paths.slice(1, 9), paths.slice(9, 10)])
    expect(new Set(imageRequests).size).toBe(4)
    expect(imageRequests).not.toContain(imagePaths[8])
    expect(imageRequests).not.toContain(imagePaths[9])
    session.destroy()
  })

  it('keeps an image request alive when a new window cancels its old prefetch consumer after foreground takeover', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = ['OEBPS/text/old.xhtml', 'OEBPS/text/new.xhtml']
    const imagePath = 'OEBPS/images/shared.png'
    const testManifest: ReaderManifest = {
      ...manifestWithTextEntries(paths.map(path => ({ path, size: 20 }))),
      entries: [
        ...manifestWithTextEntries(paths.map(path => ({ path, size: 20 }))).entries,
        { path: imagePath, size: 16 * 1024, compressedSize: 8 * 1024, compression: 'deflate', mediaType: 'image/png' },
      ],
    }
    let releaseImage!: (response: Response) => void
    let imageSignal: AbortSignal | undefined
    const imageResponse = new Promise<Response>((resolve) => { releaseImage = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/reader/texts')) {
        const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
        return Promise.resolve(jsonResponse({ data: {
          revisionId: testManifest.revisionId,
          items: requested.map(path => ({
            path,
            text: `<p>${path}</p>`,
            bytes: 10,
            resources: path === paths[0] ? [{ path: imagePath, width: 20, height: 10 }] : [],
          })),
        } }))
      }
      if (url.includes('/reader/entry')) {
        imageSignal = init?.signal ?? undefined
        return imageResponse
      }
      return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths)
    await vi.waitFor(() => expect(imageSignal).toBeDefined())
    const foreground = session.loadBlob(imagePath, 'image/png')
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.prefetchTextWindow([paths[1]!])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(imageSignal?.aborted).toBe(false)

    releaseImage(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } }))
    await expect(foreground).resolves.toBeInstanceOf(Blob)
    session.destroy()
  })

  it('uses cached coverage and only fetches the new gap after reading advances', async () => {
    setSessionAccount('user-a')
    const paths = ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml']
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 128 * 1024 })))
    const cachedPath = `${'u:user-a'}|b1|rev-1|v1|markup-v3|resource-dimensions|a.xhtml`
    vi.spyOn(idbChapterTextStore, 'get').mockImplementation(async key => (
      key === cachedPath ? { key, text: '<p>cached a</p>' } : undefined
    ))
    const batches: string[][] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: `<p>${path}</p>`, bytes: 10 })) } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths.slice(0, 3))
    await vi.waitFor(() => expect(batches).toEqual([['b.xhtml']]))
    session.prefetchTextWindow(paths.slice(1))
    await vi.waitFor(() => expect(batches).toEqual([['b.xhtml'], ['c.xhtml']]))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    session.destroy()
  })

  it('does not expand past cached or shared in-flight coverage', async () => {
    setSessionAccount('user-a')
    const paths = ['a.xhtml', 'b.xhtml', 'c.xhtml']
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 128 * 1024 })))
    const cachedKey = 'u:user-a|b1|rev-1|v1|markup-v3|resource-dimensions|a.xhtml'
    vi.spyOn(idbChapterTextStore, 'get').mockImplementation(async key => (
      key === cachedKey ? { key, text: '<p>cached</p>' } : undefined
    ))
    const batches: string[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: '<p>loaded</p>', bytes: 10 })) } })
    }))
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths)
    await vi.waitFor(() => expect(batches).toEqual([['b.xhtml']]))
    session.prefetchTextWindow(paths)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(batches).toEqual([['b.xhtml']])
    session.destroy()
  })

  it('prefetches a next chapter slightly over target alone and stops at oversized or unknown entries', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const next = 'next.xhtml'
    const farther = 'farther.xhtml'
    const testManifest = manifestWithTextEntries([
      { path: next, size: 300 * 1024 },
      { path: farther, size: 12 * 1024 },
    ])
    const batches: string[][] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      return jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: '<p>next</p>', bytes: 10 })) } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow([next, farther])
    await vi.waitFor(() => expect(batches).toEqual([[next]]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    session.destroy()

    const bounded = manifestWithTextEntries([
      { path: next, size: 9 * 1024 * 1024 },
      { path: farther, size: 12 * 1024 },
    ])
    const boundedFetch = vi.fn()
    vi.stubGlobal('fetch', boundedFetch)
    const boundedSession = new ReaderContentSession(bounded, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    boundedSession.prefetchTextWindow([next, farther])
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(boundedFetch).not.toHaveBeenCalled()
    boundedSession.destroy()

    const unknown = manifestWithTextEntries([
      { path: next, size: 0 },
      { path: farther, size: 12 * 1024 },
    ])
    const unknownFetch = vi.fn()
    vi.stubGlobal('fetch', unknownFetch)
    const unknownSession = new ReaderContentSession(unknown, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    unknownSession.prefetchTextWindow([next, farther])
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(unknownFetch).not.toHaveBeenCalled()
    unknownSession.destroy()
  })

  it('discards an old in-flight window after a fast jump', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = ['old-a.xhtml', 'old-b.xhtml', 'jump.xhtml']
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 12 * 1024 })))
    const batches: string[][] = []
    let oldRequestAborted = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/reader/texts')) return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500))
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      if (requested.includes(paths[0]!)) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            oldRequestAborted = true
            reject(init.signal?.reason)
          }, { once: true })
        })
      }
      return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: '<p>jump</p>', bytes: 10 })) } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths.slice(0, 2))
    await vi.waitFor(() => expect(batches).toEqual([[paths[0]]]))
    session.prefetchTextWindow([paths[2]!])
    await vi.waitFor(() => expect(batches).toEqual([[paths[0]], [paths[2]]]))

    expect(oldRequestAborted).toBe(true)
    session.destroy()
  })

  it('keeps a foreground batch consumer alive when its old prefetch window is cancelled', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = ['old-a.xhtml', 'old-b.xhtml', 'jump.xhtml']
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 12 * 1024 })))
    const batches: string[][] = []
    let releaseOld!: (response: Response) => void
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/reader/texts')) return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500))
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batches.push(requested)
      if (requested.includes(paths[0]!)) return new Promise<Response>(resolve => { releaseOld = resolve })
      return Promise.resolve(jsonResponse({ data: { revisionId: testManifest.revisionId, items: requested.map(path => ({ path, text: '<p>jump</p>', bytes: 10 })) } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')

    session.prefetchTextWindow(paths.slice(0, 2))
    await vi.waitFor(() => expect(batches).toEqual([[paths[0]]]))
    const foreground = session.loadText(paths[0]!)
    await new Promise(resolve => setTimeout(resolve, 0))
    session.prefetchTextWindow([paths[2]!])
    releaseOld(jsonResponse({ data: { revisionId: testManifest.revisionId, items: [{ path: paths[0], text: '<p>foreground</p>', bytes: 10 }] } }))

    await expect(foreground).resolves.toBe('<p>foreground</p>')
    await vi.waitFor(() => expect(batches).toEqual([[paths[0]], [paths[2]]]))
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/reader/entry'))).toBe(false)
    session.destroy()
  })

  it('cancels one chapter waiter without cancelling its sibling in the shared batch', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const paths = ['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml', 'OEBPS/text/ch3.xhtml']
    const testManifest = manifestWithTextEntries(paths.map(path => ({ path, size: 12 * 1024 })))
    let release!: (response: Response) => void
    const batchPaths: string[][] = []
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(_input).includes('/reader/texts')) return Promise.resolve(jsonResponse({ error: { code: 'UNEXPECTED_REQUEST' } }, 500))
      const requested = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
      batchPaths.push(requested)
      if (requested.length === 1) {
        return Promise.resolve(jsonResponse({ data: {
          revisionId: testManifest.revisionId,
          items: [{ path: requested[0]!, text: '<p>chapter 1</p>', bytes: 10 }],
        } }))
      }
      return new Promise<Response>((resolve) => { release = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    const session = new ReaderContentSession(testManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const canceledController = new AbortController()
    session.prefetchTexts(paths)
    await vi.waitFor(() => expect(batchPaths).toEqual([[paths[0]], [paths[1], paths[2]]]))
    const canceled = session.loadText(paths[1]!, 'foreground', canceledController.signal)
    const retained = session.loadText(paths[2]!)
    canceledController.abort()
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    release(jsonResponse({ data: {
      revisionId: testManifest.revisionId,
      items: paths.slice(1).map((path, index) => ({ path, text: `<p>chapter ${index + 2}</p>`, bytes: 10 })),
    } }))

    await expect(retained).resolves.toBe('<p>chapter 3</p>')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    session.destroy()
  })

  it('isolates persistent namespaces by account and content revision', () => {
    const userARev1 = new ReaderContentSession(manifest, 'u:user-a', 0, '/api/v1/books/b1/file?reader=1')
    const userBRev1 = new ReaderContentSession(manifest, 'u:user-b', 0, '/api/v1/books/b1/file?reader=1')
    const userARev2 = new ReaderContentSession({ ...manifest, revisionId: 'rev-2' }, 'u:user-a', 0, '/api/v1/books/b1/file?reader=1')

    expect(new Set([userARev1.namespace, userBRev1.namespace, userARev2.namespace]).size).toBe(3)
    userARev1.destroy()
    userBRev1.destroy()
    userARev2.destroy()
  })

  it('hands the prepared target chapter to only the matching account and revision session', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const targetManifest = { ...manifest, revisionId: 'rev-2' }
    const preparedText = '<html><body>prepared target</body></html>'
    primeReaderContentText(targetManifest, 'u:user-a', 'OEBPS/text/ch1.xhtml', preparedText)
    const fetchMock = vi.fn(async () => new Response('<html><body>network</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'application/xhtml+xml' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const oldRevision = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-1')
    await expect(oldRevision.loadText('OEBPS/text/ch1.xhtml')).resolves.toContain('network')
    oldRevision.destroy()

    const nextRevision = new ReaderContentSession(targetManifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-2')
    await expect(nextRevision.loadText('OEBPS/text/ch1.xhtml')).resolves.toBe(preparedText)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    nextRevision.destroy()

    const cachedRevision = { ...manifest, revisionId: 'rev-3' }
    const cachedSession = new ReaderContentSession(cachedRevision, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1&revisionId=rev-3')
    primeReaderContentText(cachedRevision, 'u:user-a', 'OEBPS/text/ch1.xhtml', '<html>cached handoff</html>')
    consumePreparedReaderContentText(cachedSession)
    await expect(cachedSession.loadText('OEBPS/text/ch1.xhtml')).resolves.toBe('<html>cached handoff</html>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    cachedSession.destroy()
    clearPreparedReaderContentText()
  })

  it('does not abort shared session work when only one consumer releases it', async () => {
    setSessionAccount('user-a')
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>still active</p>', { status: 200 })))
    const session = new ReaderContentSession(manifest, 'u:user-a', getSessionEpoch(), '/api/v1/books/b1/file?reader=1')
    const releaseFirst = session.retain()
    const releaseSecond = session.retain()

    releaseFirst()
    await expect(session.loadText('OEBPS/text/ch1.xhtml')).resolves.toContain('still active')
    releaseSecond()
    await expect(session.loadText('OEBPS/text/ch1.xhtml')).rejects.toBeInstanceOf(ReaderSessionChangedError)
  })

  it('rejects a manifest that does not satisfy the shared response schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { ...manifest, entries: [{ path: '../private', size: -1 }] } })))
    await expect(fetchReaderManifest('/api/v1/books/b1/file?reader=1&revisionId=rev-1'))
      .rejects.toMatchObject({ code: 'READER_MANIFEST_INVALID' })
  })

  it('invalidates this tab when another tab changes the stored account', () => {
    setSessionAccount('user-a')
    const previousEpoch = getSessionEpoch()
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'bd-user',
      newValue: JSON.stringify({ id: 'user-b', role: 'user' }),
    }))
    expect(getSessionEpoch()).toBeGreaterThan(previousEpoch)
    expect(getContentAccountScope()).toBe('u:user-b')
  })

  it('falls back only for transport/availability failures, never permission or revision errors', () => {
    expect(canFallbackReaderContent(new ReaderContentError('READER_NETWORK_ERROR', 'offline'))).toBe(true)
    expect(canFallbackReaderContent(new ReaderContentError('HTTP_404', 'missing endpoint', 404))).toBe(true)
    expect(canFallbackReaderContent(new ReaderContentError('HTTP_503', 'down', 503))).toBe(true)
    expect(canFallbackReaderContent(new ReaderContentError('FORBIDDEN', 'no access', 403))).toBe(false)
    expect(canFallbackReaderContent(new ReaderContentError('READER_REVISION_CHANGED', 'changed', 409))).toBe(false)
    expect(canFallbackReaderContent(new ReaderContentError('BOOK_NOT_FOUND', 'gone', 404))).toBe(false)
    expect(canFallbackReaderContent(new ReaderContentError('READER_ENTRY_FAILED', 'corrupt archive', 500))).toBe(false)
  })
})
