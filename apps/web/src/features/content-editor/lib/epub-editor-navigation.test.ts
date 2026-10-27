import { describe, expect, it } from 'vitest'

import type { EpubEditorDocument, EpubEditorTocEntry } from './epub-editor-draft'
import { buildEpubTocTree, findSafeEpubHeading, splitTocHref, visibleEpubText, visibleEpubTocNodes } from './epub-editor-navigation'

const entries: EpubEditorTocEntry[] = [
  { href: 'Text/one.xhtml#part-one', title: 'Part One', level: 1 },
  { href: 'Text/one.xhtml#part-two', title: 'Part Two', level: 2 },
  { href: 'Text/two.xhtml', title: 'Second File', level: 1 },
]

describe('EPUB editor navigation', () => {
  it('preserves fragments and builds searchable hierarchical navigation', () => {
    expect(splitTocHref(entries[0]!.href)).toEqual({ documentHref: 'Text/one.xhtml', fragment: 'part-one' })
    const tree = buildEpubTocTree(entries)
    expect(tree).toHaveLength(2)
    expect(tree[0]?.children.map((node) => node.index)).toEqual([1])
    expect(visibleEpubTocNodes(tree, 'part two')[0]?.children.map((node) => node.index)).toEqual([1])
  })

  it('identifies only an exact plain heading for explicit body-title synchronization', () => {
    const document: EpubEditorDocument = {
      href: 'Text/one.xhtml',
      content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="part-one">Part One</h1><p>Body</p><h2>Other</h2></body></html>',
    }
    expect(findSafeEpubHeading(document, entries[0]!)).toEqual({ headingIndex: 0, reason: null })
    expect(findSafeEpubHeading(document, { ...entries[0]!, title: 'Renamed part' })).toEqual({ headingIndex: 0, reason: null })
    expect(findSafeEpubHeading(document, { ...entries[0]!, href: 'Text/one.xhtml', title: 'Different' }).reason).toContain('唯一')
    expect(findSafeEpubHeading(document, { ...entries[0]!, href: 'Text/one.xhtml' })).toEqual({ headingIndex: 0, reason: null })
    expect(findSafeEpubHeading({ ...document, content: document.content.replace('</body>', '<h3>Part One</h3></body>') }, { ...entries[0]!, href: 'Text/one.xhtml' }).reason).toContain('唯一')
  })

  it('shows visible text without exposing XHTML as the ordinary diff', () => {
    expect(visibleEpubText('<html><body><h1>A</h1><p>Text <strong>bold</strong><br/>next</p></body></html>')).toBe('A\nText bold\nnext')
  })
})
