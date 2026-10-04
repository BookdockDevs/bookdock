import { describe, expect, it } from 'vitest'

import { bindLibrarySearch, LibrarySearchError, normalizeLibrarySearch, parseLibrarySearch, printLibrarySearch, readLibrarySearchExpression, simpleLibrarySearch } from '@bookdock/shared'

import { editSearchControls, removeSearchCondition, searchProjection } from './library-search-state'

const names = { shared: false, tags: [{ id: 'sf', name: '科幻' }, { id: 'fantasy', name: '奇幻' }, { id: 'keep', name: '收藏' }], categories: [{ id: 's', name: '书 架' }] }

describe('library search grammar and URL state', () => {
  it('keeps consecutive plain text as one legacy search item', () => {
    expect(parseLibrarySearch('三体 刘慈欣')).toMatchObject({ kind: 'text', value: '三体 刘慈欣' })
    expect(parseLibrarySearch('AND OR NOT')).toMatchObject({ kind: 'text', value: 'AND OR NOT' })
    expect(parseLibrarySearch('三体 & 刘慈欣')).toMatchObject({ kind: 'and', left: { value: '三体' }, right: { value: '刘慈欣' } })
  })
  it('gives NOT, AND and OR their required precedence with repeatable fields', () => {
    const expression = parseLibrarySearch('tag:科幻 | tag:奇幻 !tag:弃坑 & format:epub')!
    expect(expression).toMatchObject({ kind: 'or', left: { field: 'tag', value: '科幻' }, right: { kind: 'and', left: { kind: 'and', right: { kind: 'not' } }, right: { field: 'format' } } })
    expect(parseLibrarySearch('(author:甲 | author:乙) format:txt')).toMatchObject({ kind: 'and', left: { kind: 'or' } })
  })
  it('binds comma tags with AND and quotes literal punctuation', () => {
    expect(simpleLibrarySearch(bindLibrarySearch(parseLibrarySearch('tag:科幻,收藏 shelf:"书 架"')!, names))?.map((node) => node.kind === 'field' && node.id)).toEqual(['sf', 'keep', 's'])
    const quoted = parseLibrarySearch('"a & b: ! (c), \\"d\\" \\\\"')!
    expect(quoted).toMatchObject({ kind: 'text', value: 'a & b: ! (c), "d" \\' })
    expect(parseLibrarySearch(printLibrarySearch(quoted))).toMatchObject({ value: quoted.kind === 'text' ? quoted.value : '' })
  })
  it.each(['Tag:科幻', '标签:科幻', 'unknown:x', 'tag:', 'tag:科幻,', 'format:pdf', 'status:done', 'author:甲,乙', '"abc', '(tag:科幻', 'tag:科幻 |', '& 三体', '()', '三体 )', 'tag:"bad\\x"'])('rejects invalid syntax with a position: %s', (source) => {
    try { parseLibrarySearch(source); expect.unreachable('Expected a positioned error') } catch (error) {
      expect(error).toBeInstanceOf(LibrarySearchError)
      expect((error as LibrarySearchError).start).toBeGreaterThanOrEqual(0)
    }
  })
  it('rejects unavailable names and resolves ambiguous categories through full paths', () => {
    expect(() => bindLibrarySearch(parseLibrarySearch('tag:不存在')!, names)).toThrow('名称不存在')
    expect(() => bindLibrarySearch(parseLibrarySearch('category:科幻')!, names)).toThrow('仅用于共享库')
    expect(() => bindLibrarySearch(parseLibrarySearch('shelf:x')!, { ...names, shared: true })).toThrow('仅用于私库')
    expect(() => bindLibrarySearch(parseLibrarySearch('status:reading')!, { ...names, shared: true })).toThrow('仅用于私库')
    const shared = { ...names, shared: true, categories: [{ id: 'r1', name: 'Root1' }, { id: 'r2', name: 'Root2' }, { id: 'c1', name: 'Child', parentId: 'r1' }, { id: 'c2', name: 'Child', parentId: 'r2' }] }
    expect(() => bindLibrarySearch(parseLibrarySearch('category:Child')!, shared)).toThrow('歧义')
    expect(bindLibrarySearch(parseLibrarySearch('category:Root1/Child')!, shared)).toMatchObject({ id: 'c1' })
  })
  it('restores IDs after rename and rejects forged IDs and excessive trees', () => {
    const expression = bindLibrarySearch(parseLibrarySearch('tag:科幻')!, names)
    expect(bindLibrarySearch(readLibrarySearchExpression(JSON.stringify(expression)), { ...names, tags: [{ id: 'sf', name: 'renamed' }] })).toMatchObject({ id: 'sf' })
    expect(() => bindLibrarySearch({ ...expression, id: 'foreign' } as typeof expression, names)).toThrow('不存在')
    expect(() => readLibrarySearchExpression('{broken')).toThrow('无效')
    expect(() => parseLibrarySearch('!'.repeat(20) + 'x')).toThrow('嵌套过深')
  })
  it('projects only unique fields of a simple conjunction and replaces them on control edits', () => {
    const expression = JSON.stringify(bindLibrarySearch(parseLibrarySearch('tag:科幻 format:epub')!, names))
    expect(searchProjection(expression)).toEqual({ tag: 'sf', format: 'epub' })
    const next = editSearchControls({ expression }, { tag: 'keep' })
    expect(searchProjection(next.expression)).toEqual({ format: 'epub' })
    expect(next.tag).toBe('keep')
    expect(searchProjection(JSON.stringify(bindLibrarySearch(parseLibrarySearch('tag:科幻 | tag:奇幻')!, names)))).toEqual({})
    expect(searchProjection(JSON.stringify(bindLibrarySearch(parseLibrarySearch('tag:科幻,收藏')!, names)))).toEqual({})
  })
  it('keeps a complex expression intact when sidebar controls add outer restrictions', () => {
    const expression = JSON.stringify(bindLibrarySearch(parseLibrarySearch('tag:科幻 | !tag:奇幻')!, names))
    expect(editSearchControls({ expression }, { tag: 'keep' })).toEqual({ tag: 'keep' })
    expect(editSearchControls({ expression }, { expression: undefined })).toEqual({ expression: undefined })
  })
  it('removes one repeated condition and rebases positions without losing bound IDs', () => {
    const bound = bindLibrarySearch(parseLibrarySearch('tag:科幻,收藏 format:txt')!, names)
    const normalized = normalizeLibrarySearch(bound)
    expect(printLibrarySearch(normalized)).toBe('tag:科幻 & tag:收藏 & format:txt')
    const nodes = simpleLibrarySearch(normalized)!
    expect(nodes[1]).toMatchObject({ kind: 'field', id: 'keep', start: 9 })
    const next = removeSearchCondition(JSON.stringify(normalized), 0)
    expect(searchProjection(next)).toEqual({ tag: 'keep', format: 'txt' })
    expect(removeSearchCondition(JSON.stringify(parseLibrarySearch('format:txt')), 0)).toBeUndefined()
  })
})
