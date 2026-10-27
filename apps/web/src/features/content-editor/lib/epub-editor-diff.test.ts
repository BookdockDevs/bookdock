import { describe, expect, it } from 'vitest'

import { createEpubEditorDraft } from './epub-editor-draft'
import { getEpubEditorDiff } from './epub-editor-diff'

const xhtml = (text: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Private markup</title></head><body><p>${text}</p></body></html>`

describe('getEpubEditorDiff', () => {
  it('counts a document text edit once and returns only local visible-text context', () => {
    const document = { href: 'chapter.xhtml', content: xhtml(`${'A'.repeat(160)}before${'Z'.repeat(160)}`) }
    const draft = createEpubEditorDraft({ documents: [document], tocEntries: [], spineOrder: [document.href] })
    draft.documents[0]!.content = xhtml(`${'A'.repeat(160)}after${'Z'.repeat(160)}`)

    const diff = getEpubEditorDiff(draft)

    expect(diff.changeCount).toBe(1)
    expect(diff.documents).toHaveLength(1)
    expect(diff.documents[0]?.textChange?.before).toContain('before')
    expect(diff.documents[0]?.textChange?.after).toContain('after')
    expect(diff.documents[0]?.textChange?.before.length).toBeLessThan(250)
    expect(diff.documents[0]?.textChange?.before).not.toContain('Private markup')
  })

  it('matches duplicate TOC hrefs by occurrence and counts only changed title-level entries', () => {
    const draft = createEpubEditorDraft({
      documents: [],
      tocEntries: [
        { href: 'chapter.xhtml#one', title: 'First', level: 1 },
        { href: 'chapter.xhtml#one', title: 'Second', level: 2 },
      ],
      spineOrder: [],
    })
    draft.tocEntries[1] = { ...draft.tocEntries[1]!, title: 'Second revised' }

    const diff = getEpubEditorDiff(draft)

    expect(diff.changeCount).toBe(1)
    expect(diff.tocEntries).toHaveLength(1)
    expect(diff.tocEntries[0]?.before?.title).toBe('Second')
    expect(diff.tocEntries[0]?.after?.title).toBe('Second revised')
  })

  it('keeps unchanged duplicate-href entries matched when their order changes', () => {
    const draft = createEpubEditorDraft({
      documents: [],
      tocEntries: [
        { href: 'chapter.xhtml', title: 'First heading', level: 1 },
        { href: 'chapter.xhtml', title: 'Second heading', level: 1 },
      ],
      spineOrder: [],
    })
    draft.tocEntries = [draft.tocEntries[1]!, draft.tocEntries[0]!]

    const diff = getEpubEditorDiff(draft)

    expect(diff.tocEntries).toHaveLength(0)
    expect(diff.tocReordered).toBe(true)
    expect(diff.changeCount).toBe(1)
  })

  it('reports TOC and spine reorders separately without treating positions as document edits', () => {
    const documents = ['a.xhtml', 'b.xhtml', 'c.xhtml'].map((href) => ({ href, content: xhtml(href) }))
    const tocEntries = documents.map((document, index) => ({ href: document.href, title: `Chapter ${index + 1}`, level: 1 }))
    const draft = createEpubEditorDraft({ documents, tocEntries, spineOrder: documents.map((document) => document.href) })
    draft.tocEntries = [draft.tocEntries[1]!, draft.tocEntries[0]!, draft.tocEntries[2]!]
    draft.spineOrder = ['b.xhtml', 'a.xhtml', 'c.xhtml']

    const diff = getEpubEditorDiff(draft)

    expect(diff.documents).toHaveLength(0)
    expect(diff.tocEntries).toHaveLength(0)
    expect(diff.tocReordered).toBe(true)
    expect(diff.spineReordered).toBe(true)
    expect(diff.changeCount).toBe(2)
  })

  it('does not count insertion or deletion alone as a reorder', () => {
    const draft = createEpubEditorDraft({ documents: [], tocEntries: [], spineOrder: ['a.xhtml', 'b.xhtml'] })
    draft.tocEntries = [{ href: 'new.xhtml', title: 'New', level: 1 }]
    draft.spineOrder = ['new.xhtml', 'a.xhtml', 'b.xhtml']

    const diff = getEpubEditorDiff(draft)

    expect(diff.tocReordered).toBe(false)
    expect(diff.spineReordered).toBe(false)
    expect(diff.changeCount).toBe(1)
  })

  it('bounds text excerpts for large or distant changes', () => {
    const originalText = `${'A'.repeat(500)}${'C'.repeat(1000)}${'B'.repeat(500)}`
    const document = { href: 'chapter.xhtml', content: xhtml(originalText) }
    const draft = createEpubEditorDraft({ documents: [document], tocEntries: [], spineOrder: [] })
    draft.documents[0]!.content = xhtml(`${'A'.repeat(500)}${'D'.repeat(1000)}${'B'.repeat(500)}`)

    const diff = getEpubEditorDiff(draft)

    expect(diff.documents[0]?.textChange?.before.length).toBeLessThan(450)
    expect(diff.documents[0]?.textChange?.before).toContain('中间省略')
  })
})
