import { expect, it } from 'vitest'

it('provides the old Kindle browser with Foliate grouping and array methods', async () => {
  const objectApi = Object as any
  const arrayApi = Array.prototype as any
  const mapApi = Map as any
  const stringApi = String.prototype as any
  const mapGroupBy = mapApi.groupBy
  const matchAll = stringApi.matchAll
  const replaceAll = stringApi.replaceAll
  const groupBy = objectApi.groupBy
  const at = arrayApi.at
  const findLastIndex = arrayApi.findLastIndex
  try {
    delete mapApi.groupBy
    delete stringApi.matchAll
    delete stringApi.replaceAll
    delete objectApi.groupBy
    delete arrayApi.at
    delete arrayApi.findLastIndex
    await import('../eink/polyfills')
    const groups = objectApi.groupBy(['a', 'bb', 'c'], (item: string) => item.length)
    expect(groups[1]).toEqual(['a', 'c'])
    expect(groups[2]).toEqual(['bb'])
    const key = {}
    const grouped = mapApi.groupBy([1, 2, 3], (item: number) => item % 2 ? key : null)
    expect(grouped.get(key)).toEqual([1, 3])
    expect(grouped.get(null)).toEqual([2])
    expect(Array.from(stringApi.matchAll.call('p: one q: two', /([a-z]): (\w+)/g), (match: any) => match[1])).toEqual(['p', 'q'])
    expect(stringApi.replaceAll.call('a.b.a', '.', '-')).toBe('a-b-a')
    expect(stringApi.replaceAll.call('a b c', /\s/g, '')).toBe('abc')
    expect(arrayApi.at.call([1, 2], -1)).toBe(2)
    expect(arrayApi.findLastIndex.call([1, 2, 1], (value: number) => value === 1)).toBe(2)
    // @ts-expect-error plain vendored ESM without type declarations
    const { EPUB } = await import('../../public/foliate-js/epub.js')
    const files = new Map([
      ['META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
      ['OPS/package.opf', '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" prefix="example: http://example.com/" version="3.0"><metadata><dc:title>Kindle test</dc:title><meta property="example:custom">value</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'],
    ])
    const book = await new EPUB({
      entries: [...files.keys()].map(filename => ({ filename })),
      loadText: async (name: string) => files.get(name) ?? null,
      loadBlob: async () => null,
      getSize: () => 1,
    }).init()
    expect(book.metadata.title).toBe('Kindle test')
    expect(book.sections).toHaveLength(1)

  } finally {
    mapApi.groupBy = mapGroupBy
    stringApi.matchAll = matchAll
    stringApi.replaceAll = replaceAll
    objectApi.groupBy = groupBy
    arrayApi.at = at
    arrayApi.findLastIndex = findLastIndex
  }
})
