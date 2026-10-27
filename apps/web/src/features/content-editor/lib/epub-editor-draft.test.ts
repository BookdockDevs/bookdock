import { describe, expect, it } from 'vitest'

import {
  createEpubEditorDraft,
  endEpubEditorEditGroup,
  editEpubDocument,
  editEpubTocEntry,
  hasEpubEditorChanges,
  adjustEpubTocSelectionLevel,
  moveEpubTocSelection,
  moveEpubSpineDocument,
  undoEpubEditorDraft,
  redoEpubEditorDraft,
} from './epub-editor-draft'

describe('EPUB editor draft', () => {
  it('coalesces continuous document edits and bounds changed-text history', () => {
    let draft = createEpubEditorDraft({
      documents: [{ href: 'a.xhtml', content: '<html><body>A</body></html>' }],
      tocEntries: [], spineOrder: ['a.xhtml'],
    })
    draft = editEpubDocument(draft, 'a.xhtml', '<html><body>AB</body></html>')
    draft = editEpubDocument(draft, 'a.xhtml', '<html><body>ABC</body></html>')
    expect(draft.undoStack).toHaveLength(1)
    expect(undoEpubEditorDraft(draft).documents[0]?.content).toBe('<html><body>A</body></html>')

    const large = 'x'.repeat(26_000_000)
    draft = createEpubEditorDraft({ documents: [{ href: 'large.xhtml', content: large }], tocEntries: [], spineOrder: ['large.xhtml'] })
    draft = editEpubDocument(draft, 'large.xhtml', `${large} edited`)
    expect(draft.undoStack).toHaveLength(1)
    expect(draft.documents[0]?.content.endsWith(' edited')).toBe(true)
    expect(undoEpubEditorDraft(draft).documents[0]?.content).toBe(large)

    const body = 'x'.repeat(1_000_000)
    draft = createEpubEditorDraft({
      documents: [{ href: 'large.xhtml', content: 'baseline' }],
      tocEntries: [{ href: 'large.xhtml', title: 'Large', level: 1 }],
      spineOrder: ['large.xhtml'],
    })
    for (let index = 0; index < 40; index += 1) {
      draft = editEpubTocEntry(draft, 0, { title: `Title ${index}` })
      draft = editEpubDocument(draft, 'large.xhtml', `${body}${index}`)
    }
    expect(draft.undoStack.length).toBeLessThan(80)
    expect(draft.documents[0]?.content).toBe(`${body}39`)
  })

  it('ends a typing group when the user switches spine documents', () => {
    let draft = createEpubEditorDraft({ documents: [{ href: 'a.xhtml', content: 'A' }], tocEntries: [], spineOrder: ['a.xhtml'] })
    draft = editEpubDocument(draft, 'a.xhtml', 'AB')
    draft = endEpubEditorEditGroup(draft)
    draft = editEpubDocument(draft, 'a.xhtml', 'ABC')

    expect(draft.undoStack).toHaveLength(2)
  })

  it('undoes grouped TOC and spine changes as one snapshot per action', () => {
    let draft = createEpubEditorDraft({
      documents: [{ href: 'a.xhtml', content: '<html><body>A</body></html>' }, { href: 'b.xhtml', content: '<html><body>B</body></html>' }],
      tocEntries: [{ href: 'a.xhtml', title: 'A', level: 1 }],
      spineOrder: ['a.xhtml', 'b.xhtml'],
    })
    draft = editEpubTocEntry(draft, 0, { title: '第一章' })
    draft = moveEpubSpineDocument(draft, 'b.xhtml', -1)
    expect(hasEpubEditorChanges(draft)).toBe(true)
    draft = undoEpubEditorDraft(draft)
    expect(draft.spineOrder).toEqual(['a.xhtml', 'b.xhtml'])
    expect(draft.tocEntries[0]?.title).toBe('第一章')
    draft = undoEpubEditorDraft(draft)
    expect(hasEpubEditorChanges(draft)).toBe(false)
    expect(redoEpubEditorDraft(draft).tocEntries[0]?.title).toBe('第一章')
  })

  it('moves selected TOC parents with their complete subtree while leaving spine order independent', () => {
    const draft = createEpubEditorDraft({
      documents: ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml'].map((href) => ({ href, content: `<html><body>${href}</body></html>` })),
      tocEntries: [
        { href: 'a.xhtml', title: 'A', level: 1 },
        { href: 'b.xhtml', title: 'B', level: 2 },
        { href: 'c.xhtml', title: 'C', level: 3 },
        { href: 'd.xhtml', title: 'D', level: 1 },
      ],
      spineOrder: ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml'],
    })
    const moved = moveEpubTocSelection(draft, [0, 1], null, 'end')

    expect(moved.tocEntries.map((entry) => entry.title)).toEqual(['D', 'A', 'B', 'C'])
    expect(moved.tocEntries.map((entry) => entry.level)).toEqual([1, 1, 2, 3])
    expect(moved.spineOrder).toEqual(draft.spineOrder)
    expect(moved.undoStack).toHaveLength(1)
  })

  it('changes selected TOC levels as one undoable action and normalizes hierarchy', () => {
    const draft = createEpubEditorDraft({
      documents: ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml'].map((href) => ({ href, content: `<html><body>${href}</body></html>` })),
      tocEntries: [
        { href: 'a.xhtml', title: 'A', level: 1 },
        { href: 'b.xhtml', title: 'B', level: 2 },
        { href: 'c.xhtml', title: 'C', level: 2 },
        { href: 'd.xhtml', title: 'D', level: 1 },
      ],
      spineOrder: ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml'],
    })
    const adjusted = adjustEpubTocSelectionLevel(draft, [2], 1)

    expect(adjusted.tocEntries.map((entry) => entry.level)).toEqual([1, 2, 3, 1])
    expect(adjusted.undoStack).toHaveLength(1)
  })
})
