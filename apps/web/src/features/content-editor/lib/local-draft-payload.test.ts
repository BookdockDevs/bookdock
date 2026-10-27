import { describe, expect, it } from 'vitest'
import { createEditorDraft, editEditorUnit } from './editor-draft'
import { createEpubEditorDraft, editEpubDocument, moveEpubTocEntry } from './epub-editor-draft'
import { restoreEpubDraft, restoreTxtDraft, serializeTxtDraft, epubPayloadSchema, txtPayloadSchema } from './local-draft-payload'
import { draftKey } from './local-draft-store'

describe('local draft payload', () => {
  it('restores TXT changes and ordering against the loaded baseline without old history', () => {
    const baseline = createEditorDraft([{ id: 'a', title: 'A', content: 'original' }, { id: 'b', title: 'B', content: 'unchanged' }])
    const changed = editEditorUnit(baseline, 'a', { content: 'new text' })
    const data = serializeTxtDraft({ ...changed, units: [...changed.units].reverse(), activeUnitId: 'missing' })
    expect(data.units[0]?.content).toBeUndefined()
    expect(txtPayloadSchema.safeParse(data).success).toBe(true)
    const restored = restoreTxtDraft(baseline, data)!
    expect(restored.units.map((item) => item.content)).toEqual(['unchanged', 'new text'])
    expect(restored.activeUnitId).toBe('b')
    expect(restored.undoStack).toEqual([])
  })

  it('restores EPUB changed documents, directory and spine without persisting baseline or history', () => {
    const baseline = createEpubEditorDraft({ documents: [{ href: 'a', content: '<p>old</p>' }, { href: 'b', content: '<p>b</p>' }], tocEntries: [{ href: 'a', title: 'A', level: 1 }, { href: 'b', title: 'B', level: 1 }], spineOrder: ['a', 'b'] })
    const changed = moveEpubTocEntry(editEpubDocument(baseline, 'a', '<p>new</p>'), 0, 1)
    const payload = { documents: changed.documents.filter((item) => item.changed), tocEntries: changed.tocEntries, spineOrder: ['b', 'a'], view: 'files' as const, activeHref: 'a', activeTocIndex: 0 }
    expect(epubPayloadSchema.safeParse(payload).success).toBe(true)
    const restored = restoreEpubDraft(baseline, payload)!
    expect(restored.documents.map((item) => item.content)).toEqual(['<p>new</p>', '<p>b</p>'])
    expect(restored.tocEntries[0]?.title).toBe('B')
    expect(restored.spineOrder).toEqual(['b', 'a'])
    expect(restored.undoStack).toEqual([])
    expect(restoreEpubDraft(baseline, { ...payload, spineOrder: ['a', 'a'] })).toBeNull()
  })

  it('distinguishes account, content, format and shared version target', () => {
    const target = { libraryId: 'l', libraryBookId: 'w', versionLinkId: 'v' }
    expect(new Set([draftKey('u', 'b', 'txt'), draftKey('v', 'b', 'txt'), draftKey('u', 'c', 'txt'), draftKey('u', 'b', 'epub'), draftKey('u', 'b', 'txt', target), draftKey('u', 'b', 'txt', { ...target, versionLinkId: 'v2' })]).size).toBe(6)
  })
})
