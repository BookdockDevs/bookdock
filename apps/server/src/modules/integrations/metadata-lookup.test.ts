import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchMetadataCover, getDoubanMetadata, searchMetadata } from './metadata-lookup.service'

afterEach(() => vi.unstubAllGlobals())

describe('metadata lookup', () => {
  it('maps Open Library work results without treating the first edition year as the selected edition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [
      { key: '/works/OL27482W', title: 'The Hobbit', author_name: ['J. R. R. Tolkien'], first_publish_year: 1937, cover_i: 42 },
      { key: 'https://example.org/', title: 'Invalid' },
    ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchMetadata('openlibrary', 'The Hobbit')
    expect(results).toEqual([{ id: '/works/OL27482W', provider: 'openlibrary', title: 'The Hobbit', authors: ['J. R. R. Tolkien'], coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg', sourceUrl: 'https://openlibrary.org/works/OL27482W' }])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects arbitrary and redirected cover addresses before following them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchMetadataCover('openlibrary', 'https://127.0.0.1/secret')).rejects.toThrow('Unsupported cover URL')
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }))
    await expect(fetchMetadataCover('openlibrary', 'https://covers.openlibrary.org/b/id/42-M.jpg')).rejects.toThrow('Cover source unavailable')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('sniffs personal cover bytes instead of trusting mislabeled content types', async () => {
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(webp, { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    const cover = await fetchMetadataCover('personal:test-source', 'https://93.184.216.34/cover.webp')
    expect(cover.contentType).toBe('image/webp')
    const junk = Buffer.from('<html>not an image</html>')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(junk, { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    await expect(fetchMetadataCover('personal:test-source', 'https://93.184.216.34/cover.webp')).rejects.toThrow('Unsupported cover format')
  })

  it('maps Google volumes and uses the supplied test key without persisting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 'abc', volumeInfo: { title: 'A Book', authors: ['A Writer'], description: '<p>Some <b>text</b></p>', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781234567890' }] } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const results = await searchMetadata('googlebooks', 'A Book', 'test-secret')
    expect(results[0]).toMatchObject({ title: 'A Book', authors: ['A Writer'], description: 'Some text', isbn: '9781234567890' })
    expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get('key')).toBe('test-secret')
  })

  it('extracts Qidian metadata from the public search page', async () => {
    const data = { pageContext: { pageProps: { pageData: { bookInfo: { records: [{ bid: 123, bName: 'Title', bAuth: 'Author', desc: 'Description' }] } } } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<script id="vite-plugin-ssr_pageContext">${JSON.stringify(data)}</script>`)))
    expect(await searchMetadata('qidian', 'Title')).toEqual([{ id: '123', provider: 'qidian', title: 'Title', authors: ['Author'], description: 'Description', coverUrl: 'https://bookcover.yuewen.com/qdbimg/349573/123/300', sourceUrl: 'https://www.qidian.com/book/123/' }])
  })

  it('maps Bangumi book infobox fields without guessing authors from tags', async () => {
    const data = { data: [{ id: 12, name: 'Title', summary: 'Description', infobox: [{ key: '作者', value: 'Author' }, { key: 'ISBN', value: '9781234567890' }], images: { medium: 'https://lain.bgm.tv/r/800/pic/cover/l/ab/12/example.jpg' } }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))))
    expect((await searchMetadata('bangumi', 'Title'))[0]).toMatchObject({ title: 'Title', authors: ['Author'], isbn: '9781234567890', provider: 'bangumi' })
  })

  it('preserves plain-text Qidian and Bangumi description whitespace and omits blank descriptions', async () => {
    const description = `　　First\r\n${'x'.repeat(6000)}\r\n  `
    const qidian = { pageContext: { pageProps: { pageData: { bookInfo: { records: [{ bid: 123, bName: 'Title', desc: description }, { bid: 456, bName: 'Blank', desc: '　 \n' }] } } } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(`<script id="vite-plugin-ssr_pageContext">${JSON.stringify(qidian)}</script>`))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 12, name: 'Title', summary: description }, { id: 13, name: 'Blank', summary: '　 \n' }] }))))
    const qidianResults = await searchMetadata('qidian', 'Title')
    const bangumiResults = await searchMetadata('bangumi', 'Title')
    for (const results of [qidianResults, bangumiResults]) {
      expect(results[0]?.description).toBe(description)
      expect(results[1]?.description).toBeUndefined()
    }
  })

  it('retains long descriptions from Google Books and Douban', async () => {
    const description = 'x'.repeat(11000)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'abc', volumeInfo: { title: 'Book', description: `<p>${description}</p>` } }] })))
      .mockResolvedValueOnce(new Response(`<span property="v:itemreviewed">Book</span><div id="info"></div><div id="link-report"><div class="intro"><p>${description}</p></div></div>`)))
    expect((await searchMetadata('googlebooks', 'Book', 'test-secret'))[0]?.description).toBe(description)
    expect((await getDoubanMetadata('123')).description).toBe(description)
  })

  it('loads Douban candidates and fetches details only for the selected book', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<div class="result-list"><div class="result"><a class="nbg" title="A &amp; B" onclick="moreurl(this,{sid: 123})"><img src="https://img3.doubanio.com/view/subject/s/public/s123.jpg"></a><span class="subject-cast">Writer / Publisher / 2020</span></div></div>'))
      .mockResolvedValueOnce(new Response('<meta property="og:image" content="https://img3.doubanio.com/view/subject/l/public/s123.jpg"><span property="v:itemreviewed">A &amp; B</span><div id="info"><span class="pl">作者</span>: Writer<br><span class="pl">出版社:</span> Publisher<br><span class="pl">出版年:</span> 2020<br><span class="pl">ISBN:</span> 9781234567890<br></div><div id="link-report"><div class="intro"><p>Introduction.</p></div></div>'))
    vi.stubGlobal('fetch', fetchMock)
    const candidates = await searchMetadata('douban', 'A & B')
    expect(candidates).toMatchObject([{ id: '123', title: 'A & B', authors: ['Writer'], provider: 'douban' }])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(await getDoubanMetadata('123')).toMatchObject({ title: 'A & B', authors: ['Writer'], publisher: 'Publisher', published: '2020', isbn: '9781234567890', description: 'Introduction.', coverUrl: 'https://img3.doubanio.com/view/subject/l/public/s123.jpg' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports Douban access blocks and disallows unrelated cover hosts and detail IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>搜索访问太频繁</html>'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchMetadata('douban', 'Book')).rejects.toThrow('Douban search response could not be read')
    await expect(getDoubanMetadata('../secret')).rejects.toThrow('Invalid Douban book ID')
    await expect(fetchMetadataCover('douban', 'https://img3.doubanio.com.evil.example/view/subject/l/public/s123.jpg')).rejects.toThrow('Unsupported cover URL')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the Douban page as referrer for its cover server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchMetadataCover('douban', 'https://img3.doubanio.com/view/subject/l/public/s123.jpg')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { Referer: 'https://book.douban.com/' } })
  })
})
