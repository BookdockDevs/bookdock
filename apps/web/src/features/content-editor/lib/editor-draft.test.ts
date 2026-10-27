import { describe, expect, it } from 'vitest'

import {
  adjustEditorUnitLevel,
  adjustEditorUnitsLevel,
  applyEditorBatch,
  createEditorDraft,
  discardEditorDraft,
  deleteEditorUnits,
  editEditorUnit,
  getEditorDraftDiff,
  insertEditorUnits,
  mergeEditorUnits,
  moveEditorUnits,
  moveEditorUnitsBefore,
  moveEditorUnitsBy,
  redoEditorDraft,
  selectEditorUnit,
  setEditorDraftTocRule,
  splitEditorUnit,
  undoEditorDraft,
} from './editor-draft'

const source = [
  { id: 'one', title: 'Chapter 1', content: '<p>First</p>' },
  { id: 'two', title: 'Chapter 2', content: '<p>Second</p>' },
]

describe('editor draft', () => {
  it('coalesces continuous typing per chapter and ends the group on chapter switches', () => {
    let draft = createEditorDraft(source)
    draft = editEditorUnit(draft, 'one', { content: 'a' })
    draft = editEditorUnit(draft, 'one', { content: 'ab' })
    expect(draft.undoStack).toHaveLength(1)
    draft = undoEditorDraft(draft)
    expect(draft.units[0]?.content).toBe('<p>First</p>')

    draft = editEditorUnit(draft, 'one', { content: 'a' })
    draft = selectEditorUnit(draft, 'two')
    draft = editEditorUnit(draft, 'one', { content: 'ab' })
    expect(draft.undoStack).toHaveLength(2)
  })

  it('keeps baseline text out of the history budget while bounding changed-text history', () => {
    const large = 'x'.repeat(26_000_000)
    let draft = createEditorDraft([{ id: 'large', title: 'Large', content: large }])
    draft = editEditorUnit(draft, 'large', { content: `${large} edited` })
    expect(draft.undoStack).toHaveLength(1)
    expect(draft.units[0]?.content.endsWith(' edited')).toBe(true)
    expect(getEditorDraftDiff(draft)).toHaveLength(1)
    expect(undoEditorDraft(draft).units[0]?.content).toBe(large)

    const body = 'x'.repeat(1_000_000)
    draft = createEditorDraft([{ id: 'large', title: 'Large', content: 'baseline' }])
    for (let index = 0; index < 40; index += 1) {
      draft = editEditorUnit(draft, 'large', { title: `Title ${index}` })
      draft = editEditorUnit(draft, 'large', { content: `${body}${index}` })
    }
    expect(draft.undoStack.length).toBeLessThan(80)
    expect(draft.units[0]?.content).toBe(`${body}39`)
  })

  it('keeps edits across selection changes and reports changes against the baseline', () => {
    let draft = createEditorDraft(source)
    draft = editEditorUnit(draft, 'one', { content: '<p>Edited first</p>' })
    draft = selectEditorUnit(draft, 'two')
    draft = editEditorUnit(draft, 'two', { title: 'Renamed chapter' })

    expect(draft.activeUnitId).toBe('two')
    expect(getEditorDraftDiff(draft)).toMatchObject([
      { id: 'one', titleChanged: false, contentChanged: true },
      { id: 'two', titleChanged: true, contentChanged: false },
    ])
  })

  it('undoes a batch as one step and supports redo', () => {
    let draft = createEditorDraft(source)
    draft = applyEditorBatch(draft, [source[1], source[0]])

    expect(draft.units.map((unit) => unit.id)).toEqual(['two', 'one'])
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['one', 'two'])
    draft = redoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['two', 'one'])
  })

  it('undoes a rechapter and its rule selection together', () => {
    const originalRule = { ruleId: 'rule-a', patterns: [{ level: 1, regex: '^Chapter', replacement: '', enabled: true }], label: 'Rule A', auto: false }
    const nextRule = { ruleId: 'rule-b', patterns: [{ level: 1, regex: '^Part', replacement: '', enabled: true }], label: 'Rule B', auto: false }
    let draft = createEditorDraft(source, originalRule)
    draft = applyEditorBatch(draft, [{ id: 'new', title: 'Part 1', content: 'Edited split' }], nextRule)

    expect(draft.tocRuleSelection).toEqual(nextRule)
    expect(getEditorDraftDiff(draft)).toHaveLength(3)
    draft = undoEditorDraft(draft)
    expect(draft.units).toEqual(source)
    expect(draft.tocRuleSelection).toEqual(originalRule)
    draft = redoEditorDraft(draft)
    expect(draft.tocRuleSelection).toEqual(nextRule)

    draft = setEditorDraftTocRule(draft, originalRule)
    expect(draft.undoStack).toHaveLength(2)
    expect(setEditorDraftTocRule(draft, originalRule)).toBe(draft)
  })

  it('marks a split heading as structural until the title itself is edited', () => {
    let draft = createEditorDraft(source)
    draft = splitEditorUnit(draft, 'one', 3, { id: 'split', title: '新章节', content: '', structureOnlyTitle: true })
    expect(draft.units[1]?.structureOnlyTitle).toBe(true)
    draft = editEditorUnit(draft, 'split', { title: '已修改的新标题' })
    expect(draft.units[1]?.structureOnlyTitle).toBe(false)
  })

  it('discards all unsaved changes and clears the local history', () => {
    let draft = createEditorDraft(source)
    draft = editEditorUnit(draft, 'one', { content: '<p>Unsaved</p>' })
    draft = discardEditorDraft(draft)

    expect(draft.units).toEqual(source)
    expect(getEditorDraftDiff(draft)).toEqual([])
    expect(draft.undoStack).toEqual([])
    expect(draft.redoStack).toEqual([])
  })

  it('keeps selected order and records multi-select moves as one undo step', () => {
    let draft = createEditorDraft([
      source[0],
      source[1],
      { id: 'three', title: 'Chapter 3', content: '<p>Third</p>' },
      { id: 'four', title: 'Chapter 4', content: '<p>Fourth</p>' },
    ])
    draft = moveEditorUnits(draft, ['three', 'one'], 2)

    expect(draft.units.map((unit) => unit.id)).toEqual(['two', 'four', 'one', 'three'])
    expect(getEditorDraftDiff(draft).filter((change) => change.orderChanged).map((change) => change.id).sort())
      .toEqual(['four', 'one', 'three', 'two'])
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('moves selected subtrees one slot in document order', () => {
    const draft = createEditorDraft([
      { id: 'one', title: 'One', content: '' },
      { id: 'two', title: 'Two', content: '' },
      { id: 'three', title: 'Three', content: '' },
      { id: 'four', title: 'Four', content: '' },
    ])

    expect(moveEditorUnitsBy(draft, ['three', 'two'], 'down').units.map((unit) => unit.id))
      .toEqual(['one', 'four', 'two', 'three'])
  })

  it('moves selected 1-based TXT chapter levels as one batch', () => {
    const draft = createEditorDraft([
      { id: 'one', title: 'One', level: 1, content: '' },
      { id: 'two', title: 'Two', level: 1, content: '' },
      { id: 'three', title: 'Three', level: 1, content: '' },
    ])

    expect(moveEditorUnitsBy(draft, ['one', 'two'], 'down').units.map((unit) => unit.id))
      .toEqual(['three', 'one', 'two'])
  })

  it('adds and deletes units as reversible structural edits', () => {
    let draft = createEditorDraft(source)
    draft = insertEditorUnits(draft, 1, [{ id: 'new', title: 'New chapter', content: '' }])
    expect(draft.units.map((unit) => unit.id)).toEqual(['one', 'new', 'two'])
    draft = deleteEditorUnits(draft, ['one', 'two'])
    expect(draft.units.map((unit) => unit.id)).toEqual(['new'])
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['one', 'new', 'two'])
  })

  it('applies added chapters and the selected TOC rule as one draft action', () => {
    const initialRule = { ruleId: null, patterns: null, label: null, auto: false }
    const selectedRule = { ruleId: 'rule-a', patterns: [{ level: 1, regex: '^Chapter', replacement: null, enabled: true }], label: 'Rule A', auto: false }
    let draft = createEditorDraft(source, initialRule)
    draft = insertEditorUnits(draft, 1, [{ id: 'added', title: 'Chapter 3', content: 'New text' }], selectedRule)
    expect(draft.tocRuleSelection).toEqual(selectedRule)
    draft = undoEditorDraft(draft)
    expect(draft.units).toEqual(source)
    expect(draft.tocRuleSelection).toEqual(initialRule)
  })

  it('moves a selected parent with its descendants as one ordered batch', () => {
    let draft = createEditorDraft([
      { id: 'volume', title: 'Volume', level: 0, content: '' },
      { id: 'child', title: 'Chapter', level: 1, content: 'Child' },
      { id: 'other', title: 'Other volume', level: 0, content: '' },
    ])
    draft = moveEditorUnits(draft, ['volume'], 1)

    expect(draft.units.map((unit) => unit.id)).toEqual(['other', 'volume', 'child'])
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['volume', 'child', 'other'])
  })

  it('deletes a selected subtree and adjusts a parent level with its descendants', () => {
    let draft = createEditorDraft([
      { id: 'volume', title: 'Volume', level: 0, content: '' },
      { id: 'chapter', title: 'Chapter', level: 1, content: 'Body' },
      { id: 'section', title: 'Section', level: 2, content: 'Nested' },
      { id: 'next', title: 'Next volume', level: 0, content: '' },
    ])
    draft = adjustEditorUnitLevel(draft, 'chapter', 0)
    expect(draft.units.map((unit) => unit.level)).toEqual([0, 0, 1, 0])
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.level)).toEqual([0, 1, 2, 0])
    draft = deleteEditorUnits(draft, ['volume'])
    expect(draft.units.map((unit) => unit.id)).toEqual(['next'])
  })

  it('splits one chapter and merges consecutive siblings with one undo step each', () => {
    let draft = createEditorDraft([
      { id: 'one', title: 'First', level: 1, content: 'AlphaBeta' },
      { id: 'two', title: 'Second', level: 1, content: 'Gamma' },
      { id: 'three', title: 'Third', level: 1, content: 'Delta' },
    ])
    draft = splitEditorUnit(draft, 'one', 5, { id: 'split', title: 'New chapter', content: '' })
    expect(draft.units.map((unit) => [unit.id, unit.content])).toEqual([
      ['one', 'Alpha'], ['split', 'Beta'], ['two', 'Gamma'], ['three', 'Delta'],
    ])
    expect(draft.activeUnitId).toBe('split')
    draft = mergeEditorUnits(draft, ['split', 'two'])
    expect(draft.units.find((unit) => unit.id === 'split')).toMatchObject({
      title: 'New chapter', content: 'Beta\n\nGamma',
    })
    draft = undoEditorDraft(draft)
    expect(draft.units.map((unit) => unit.id)).toEqual(['one', 'split', 'two', 'three'])
  })

  it('moves a selected subtree before a target and undoes it as one batch', () => {
    const nested = createEditorDraft([
      { id: 'a', title: 'A', content: '', level: 0 },
      { id: 'a1', title: 'A1', content: '', level: 1 },
      { id: 'b', title: 'B', content: '', level: 0 },
      { id: 'c', title: 'C', content: '', level: 0 },
    ])
    const moved = moveEditorUnitsBefore(nested, ['a'], 'c')
    expect(moved.units.map((unit) => unit.id)).toEqual(['b', 'a', 'a1', 'c'])
    expect(undoEditorDraft(moved).units.map((unit) => unit.id)).toEqual(['a', 'a1', 'b', 'c'])
  })

  it('adjusts all selected hierarchy roots and descendants in one undo step', () => {
    const nested = createEditorDraft([
      { id: 'a', title: 'A', content: '', level: 0 },
      { id: 'a1', title: 'A1', content: '', level: 1 },
      { id: 'b', title: 'B', content: '', level: 0 },
    ])
    const changed = adjustEditorUnitsLevel(nested, ['a', 'b'], 1)
    expect(changed.units.map((unit) => unit.level)).toEqual([1, 2, 1])
    expect(undoEditorDraft(changed).units.map((unit) => unit.level)).toEqual([0, 1, 0])
  })

  it('does not mark surviving chapters as orderChanged when a chapter is inserted or deleted', () => {
    const chapters = [
      { id: 'c1', title: 'Chapter 1', content: 'one' },
      { id: 'c2', title: 'Chapter 2', content: 'two' },
      { id: 'c3', title: 'Chapter 3', content: 'three' },
      { id: 'c4', title: 'Chapter 4', content: 'four' },
    ]
    let draft = createEditorDraft(chapters)

    // Insert a new chapter after Chapter 1
    draft = insertEditorUnits(draft, 1, [{ id: 'new-c', title: 'New Chapter', content: '' }])

    const diffsAfterInsert = getEditorDraftDiff(draft)
    expect(diffsAfterInsert).toHaveLength(1)
    expect(diffsAfterInsert[0]).toMatchObject({
      id: 'new-c',
      before: null,
      afterIndex: 1,
      titleChanged: false,
      contentChanged: false,
      levelChanged: false,
      orderChanged: false,
    })

    // Now delete Chapter 3
    draft = deleteEditorUnits(draft, ['c3'])
    const diffsAfterDelete = getEditorDraftDiff(draft)
    // Should have 2 diffs: 'new-c' added and 'c3' deleted. Neither c1, c2, nor c4 should be orderChanged!
    expect(diffsAfterDelete).toHaveLength(2)
    const orderChanged = diffsAfterDelete.filter((d) => d.orderChanged)
    expect(orderChanged).toHaveLength(0)
    expect(diffsAfterDelete.find((d) => d.id === 'c3')?.after).toBeNull()
  })
})
