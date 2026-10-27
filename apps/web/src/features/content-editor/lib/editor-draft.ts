import type { TocRulePattern } from '@bookdock/shared'

export interface EditorUnit {
  id: string
  title: string
  content: string
  level?: number
  structureOnlyTitle?: boolean
  titleChanged?: boolean
  contentChanged?: boolean
}

export interface EditorTocRuleSelection {
  ruleId: string | null
  patterns: TocRulePattern[] | null
  label: string | null
  auto: boolean
}

interface EditorSnapshot {
  units: EditorUnit[]
  tocRuleSelection: EditorTocRuleSelection
  weight: number
}

const HISTORY_BYTE_BUDGET = 48 * 1024 * 1024
const HISTORY_STEP_LIMIT = 100
const TYPING_MERGE_MS = 750

export interface EditorDraft {
  readonly baseline: readonly EditorUnit[]
  readonly baselineTocRuleSelection: EditorTocRuleSelection
  readonly units: readonly EditorUnit[]
  readonly tocRuleSelection: EditorTocRuleSelection
  readonly activeUnitId: string | null
  readonly undoStack: readonly EditorSnapshot[]
  readonly redoStack: readonly EditorSnapshot[]
  readonly lastEdit?: { key: string; at: number }
}

export interface EditorUnitDiff {
  id: string
  before: EditorUnit | null
  after: EditorUnit | null
  titleChanged: boolean
  contentChanged: boolean
  levelChanged: boolean
  orderChanged: boolean
  beforeIndex: number | null
  afterIndex: number | null
}

function snapshot(units: readonly EditorUnit[]): EditorUnit[] {
  return units.map((unit) => ({ ...unit }))
}

function selectionSnapshot(selection: EditorTocRuleSelection): EditorTocRuleSelection {
  return { ...selection, patterns: selection.patterns?.map((pattern) => ({ ...pattern })) ?? null }
}

function sameSelection(left: EditorTocRuleSelection, right: EditorTocRuleSelection): boolean {
  return left.ruleId === right.ruleId && left.label === right.label && left.auto === right.auto
    && (left.patterns === right.patterns || Boolean(left.patterns && right.patterns
      && left.patterns.length === right.patterns.length
      && left.patterns.every((pattern, index) => {
        const other = right.patterns![index]!
        return pattern.level === other.level && pattern.regex === other.regex
          && pattern.replacement === other.replacement && pattern.enabled === other.enabled
      })))
}

function sameUnits(left: readonly EditorUnit[], right: readonly EditorUnit[]): boolean {
  return left.length === right.length && left.every((unit, index) => {
    const other = right[index]!
    return unit.id === other.id && unit.title === other.title && unit.content === other.content
      && unit.level === other.level && unit.structureOnlyTitle === other.structureOnlyTitle
      && unit.titleChanged === other.titleChanged && unit.contentChanged === other.contentChanged
  })
}

function snapshotWeight(units: readonly EditorUnit[], baseline: readonly EditorUnit[]): number {
  const baselineById = new Map(baseline.map((unit) => [unit.id, unit]))
  return units.reduce((sum, unit) => {
    const original = baselineById.get(unit.id)
    const retainedText = original
      ? (unit.title === original.title ? 0 : unit.title.length * 2) + (unit.content === original.content ? 0 : unit.content.length * 2)
      : (unit.id.length + unit.title.length + unit.content.length) * 2
    return sum + 8 + retainedText
  }, 64)
}

function snapshotDraft(draft: Pick<EditorDraft, 'units' | 'baseline' | 'tocRuleSelection'>): EditorSnapshot {
  return { units: draft.units as EditorUnit[], tocRuleSelection: selectionSnapshot(draft.tocRuleSelection), weight: snapshotWeight(draft.units, draft.baseline) }
}

function trimHistory(undoStack: EditorSnapshot[], redoStack: EditorSnapshot[]): { undoStack: EditorSnapshot[]; redoStack: EditorSnapshot[] } {
  const undo = [...undoStack]
  const redo = [...redoStack]
  let total = [...undo, ...redo].reduce((sum, item) => sum + item.weight, 0)
  while (undo.length + redo.length > HISTORY_STEP_LIMIT || total > HISTORY_BYTE_BUDGET) {
    const oldestUndo = undo[0]
    const oldestRedo = redo[0]
    if (!oldestUndo && !oldestRedo) break
    const removeUndo = !oldestRedo || (oldestUndo && oldestUndo.weight <= oldestRedo.weight)
    const removed = removeUndo ? undo.shift()! : redo.shift()!
    total -= removed.weight
  }
  return { undoStack: undo, redoStack: redo }
}

function pushUndo(draft: EditorDraft, units: readonly EditorUnit[], tocRuleSelection = draft.tocRuleSelection, coalesceKey?: string): EditorDraft {
  const now = Date.now()
  const coalesce = coalesceKey && draft.lastEdit?.key === coalesceKey && now - draft.lastEdit.at <= TYPING_MERGE_MS
  const undoStack = coalesce ? [...draft.undoStack] : [...draft.undoStack, snapshotDraft(draft)]
  const bounded = trimHistory(undoStack, [])
  return {
    ...draft,
    units: snapshot(units),
    tocRuleSelection: selectionSnapshot(tocRuleSelection),
    ...bounded,
    redoStack: [],
    lastEdit: coalesceKey ? { key: coalesceKey, at: now } : undefined,
  }
}

export function createEditorDraft(units: readonly EditorUnit[], tocRuleSelection: EditorTocRuleSelection = {
  ruleId: null, patterns: null, label: null, auto: false,
}): EditorDraft {
  const initialUnits = snapshot(units)
  return {
    baseline: snapshot(initialUnits),
    baselineTocRuleSelection: selectionSnapshot(tocRuleSelection),
    units: initialUnits,
    tocRuleSelection: selectionSnapshot(tocRuleSelection),
    activeUnitId: initialUnits[0]?.id ?? null,
    undoStack: [],
    redoStack: [],
  }
}

export function setEditorDraftTocRule(draft: EditorDraft, selection: EditorTocRuleSelection): EditorDraft {
  if (sameSelection(draft.tocRuleSelection, selection)) return draft
  return pushUndo(draft, draft.units, selection)
}

export function selectEditorUnit(draft: EditorDraft, id: string): EditorDraft {
  if (!draft.units.some((unit) => unit.id === id) || draft.activeUnitId === id) return draft
  return { ...draft, activeUnitId: id, lastEdit: undefined }
}

export function editEditorUnit(
  draft: EditorDraft,
  id: string,
  change: Partial<Pick<EditorUnit, 'title' | 'content'>>,
): EditorDraft {
  const current = draft.units.find((unit) => unit.id === id)
  if (!current || (change.title === current.title && change.content === current.content)) return draft
  const baseline = draft.baseline.find((unit) => unit.id === id)
  const units = draft.units.map((unit) => unit.id === id
    ? {
      ...unit,
      ...change,
      ...(change.title !== undefined ? { titleChanged: change.title !== baseline?.title } : {}),
      ...(change.content !== undefined ? { contentChanged: change.content !== baseline?.content } : {}),
      ...(change.title !== undefined && change.title !== unit.title ? { structureOnlyTitle: false } : {}),
    }
    : unit)
  const field = change.content !== undefined ? 'content' : 'title'
  return pushUndo(draft, units, draft.tocRuleSelection, `unit:${id}:${field}`)
}

export function applyEditorBatch(draft: EditorDraft, units: readonly EditorUnit[], selection?: EditorTocRuleSelection): EditorDraft {
  const nextSelection = selection ?? draft.tocRuleSelection
  if (sameUnits(draft.units, units) && sameSelection(draft.tocRuleSelection, nextSelection)) return draft
  const ids = new Set(units.map((unit) => unit.id))
  const activeUnitId = draft.activeUnitId && ids.has(draft.activeUnitId)
    ? draft.activeUnitId
    : units[0]?.id ?? null
  return { ...pushUndo(draft, snapshot(units), nextSelection), activeUnitId }
}

export function insertEditorUnits(draft: EditorDraft, index: number, inserted: readonly EditorUnit[], selection?: EditorTocRuleSelection): EditorDraft {
  if (inserted.length === 0) return draft
  const existingIds = new Set(draft.units.map((unit) => unit.id))
  const insertedIds = new Set(inserted.map((unit) => unit.id))
  if (insertedIds.size !== inserted.length || inserted.some((unit) => existingIds.has(unit.id))) return draft
  const insertionIndex = Math.max(0, Math.min(index, draft.units.length))
  const units = [...draft.units.slice(0, insertionIndex), ...inserted, ...draft.units.slice(insertionIndex)]
  const next = pushUndo(draft, units, selection ?? draft.tocRuleSelection)
  return { ...next, activeUnitId: inserted[0]?.id ?? next.activeUnitId }
}

export function getEditorUnitSubtreeIndexes(units: readonly EditorUnit[], ids: readonly string[]): Set<number> {
  const selectedIds = new Set(ids)
  const selectedIndexes = new Set<number>()
  for (let index = 0; index < units.length; index += 1) {
    if (!selectedIds.has(units[index]!.id) || selectedIndexes.has(index)) continue
    const rootLevel = units[index]!.level ?? 0
    selectedIndexes.add(index)
    for (let child = index + 1; child < units.length; child += 1) {
      if ((units[child]!.level ?? 0) <= rootLevel) break
      selectedIndexes.add(child)
    }
  }
  return selectedIndexes
}

export function deleteEditorUnits(draft: EditorDraft, ids: readonly string[]): EditorDraft {
  const selectedIndexes = getEditorUnitSubtreeIndexes(draft.units, ids)
  if (selectedIndexes.size === 0) return draft
  const removedIds = new Set([...selectedIndexes].map((index) => draft.units[index]!.id))
  const units = draft.units.filter((_, index) => !selectedIndexes.has(index))
  const next = pushUndo(draft, units)
  return {
    ...next,
    activeUnitId: draft.activeUnitId && !removedIds.has(draft.activeUnitId)
      ? draft.activeUnitId
      : units[0]?.id ?? null,
  }
}

export function moveEditorUnits(draft: EditorDraft, ids: readonly string[], targetIndex: number): EditorDraft {
  const selectedIndexes = getEditorUnitSubtreeIndexes(draft.units, ids)
  const selected = draft.units.filter((_, index) => selectedIndexes.has(index))
  if (selected.length === 0) return draft
  const remaining = draft.units.filter((_, index) => !selectedIndexes.has(index))
  const insertionIndex = Math.max(0, Math.min(targetIndex, remaining.length))
  const units = [...remaining.slice(0, insertionIndex), ...selected, ...remaining.slice(insertionIndex)]
  if (units.some((unit, index) => (unit.level ?? 0) > ((units[index - 1]?.level ?? 0) + 1))) return draft
  return applyEditorBatch(draft, units)
}

export function moveEditorUnitsBy(draft: EditorDraft, ids: readonly string[], direction: 'up' | 'down'): EditorDraft {
  const selectedIndexes = getEditorUnitSubtreeIndexes(draft.units, ids)
  if (selectedIndexes.size === 0) return draft
  const firstIndex = Math.min(...selectedIndexes)
  const lastIndex = Math.max(...selectedIndexes)
  const targetIndex = direction === 'up' ? firstIndex - 1 : lastIndex + 2 - selectedIndexes.size
  if (targetIndex < 0 || targetIndex > draft.units.length - selectedIndexes.size) return draft
  return moveEditorUnits(draft, ids, targetIndex)
}

export function moveEditorUnitsBefore(draft: EditorDraft, ids: readonly string[], targetId: string): EditorDraft {
  const targetIndex = draft.units.findIndex((unit) => unit.id === targetId)
  const selectedIndexes = getEditorUnitSubtreeIndexes(draft.units, ids)
  if (targetIndex < 0 || selectedIndexes.has(targetIndex)) return draft
  const adjustedIndex = targetIndex - [...selectedIndexes].filter((index) => index < targetIndex).length
  return moveEditorUnits(draft, ids, adjustedIndex)
}

export function adjustEditorUnitLevel(draft: EditorDraft, id: string, level: number): EditorDraft {
  const index = draft.units.findIndex((unit) => unit.id === id)
  if (index < 0 || !Number.isInteger(level) || level < 0) return draft
  const currentLevel = draft.units[index]!.level ?? 0
  const delta = level - currentLevel
  if (delta === 0) return draft
  const previousLevel = draft.units[index - 1]?.level ?? -1
  if (level > previousLevel + 1) return draft

  let end = index + 1
  while (end < draft.units.length && (draft.units[end]!.level ?? 0) > currentLevel) end += 1
  const units = [...draft.units]
  for (let child = index; child < end; child += 1) {
    const childLevel = (units[child]!.level ?? 0) + delta
    if (childLevel < 0) return draft
    units[child] = { ...units[child]!, level: childLevel }
  }
  return applyEditorBatch(draft, units)
}

export function adjustEditorUnitsLevel(draft: EditorDraft, ids: readonly string[], delta: number): EditorDraft {
  if (!Number.isInteger(delta) || delta === 0) return draft
  const selectedIndexes = getEditorUnitSubtreeIndexes(draft.units, ids)
  if (!selectedIndexes.size) return draft
  const units = snapshot(draft.units)
  for (const index of selectedIndexes) {
    const level = (units[index]!.level ?? 0) + delta
    if (level < 0) return draft
    units[index] = { ...units[index]!, level }
  }
  if (units.some((unit, index) => (unit.level ?? 0) > ((units[index - 1]?.level ?? 0) + 1))) return draft
  return applyEditorBatch(draft, units)
}

export function splitEditorUnit(draft: EditorDraft, id: string, offset: number, newUnit: EditorUnit): EditorDraft {
  const index = draft.units.findIndex((unit) => unit.id === id)
  const currentLevel = index >= 0 ? (draft.units[index]!.level ?? 0) : 0
  if (index < 0 || (draft.units[index + 1] && (draft.units[index + 1]!.level ?? 0) > currentLevel)) return draft
  if (draft.units.some((unit) => unit.id === newUnit.id)) return draft
  const current = draft.units[index]!
  const boundedOffset = Math.max(0, Math.min(offset, current.content.length))
  const nextUnit = { ...newUnit, level: current.level ?? 0 }
  const units = [...draft.units]
  units[index] = { ...current, content: current.content.slice(0, boundedOffset) }
  units.splice(index + 1, 0, { ...nextUnit, content: current.content.slice(boundedOffset) })
  return { ...applyEditorBatch(draft, units), activeUnitId: newUnit.id }
}

export function mergeEditorUnits(draft: EditorDraft, ids: readonly string[]): EditorDraft {
  const selectedIds = new Set(ids)
  const indexes = draft.units.flatMap((unit, index) => selectedIds.has(unit.id) ? [index] : [])
  if (indexes.length < 2 || indexes.length !== selectedIds.size || indexes.at(-1)! - indexes[0]! + 1 !== indexes.length) return draft
  const selected = draft.units.slice(indexes[0], indexes.at(-1)! + 1)
  const level = selected[0]!.level ?? 0
  if (selected.some((unit) => (unit.level ?? 0) !== level) || draft.units[indexes.at(-1)! + 1] && (draft.units[indexes.at(-1)! + 1]!.level ?? 0) > level) return draft
  const merged = {
    ...selected[0]!,
    content: selected.map((unit) => unit.content).filter(Boolean).join('\n\n'),
  }
  return applyEditorBatch(draft, [
    ...draft.units.slice(0, indexes[0]),
    merged,
    ...draft.units.slice(indexes.at(-1)! + 1),
  ])
}

export function undoEditorDraft(draft: EditorDraft): EditorDraft {
  const previous = draft.undoStack.at(-1)
  if (!previous) return draft
  return {
    ...draft,
    units: snapshot(previous.units),
    tocRuleSelection: selectionSnapshot(previous.tocRuleSelection),
    activeUnitId: previous.units.some((unit) => unit.id === draft.activeUnitId)
      ? draft.activeUnitId
      : previous.units[0]?.id ?? null,
    undoStack: draft.undoStack.slice(0, -1),
    redoStack: [...draft.redoStack, snapshotDraft(draft)],
    lastEdit: undefined,
  }
}

export function redoEditorDraft(draft: EditorDraft): EditorDraft {
  const next = draft.redoStack.at(-1)
  if (!next) return draft
  return {
    ...draft,
    units: snapshot(next.units),
    tocRuleSelection: selectionSnapshot(next.tocRuleSelection),
    activeUnitId: next.units.some((unit) => unit.id === draft.activeUnitId)
      ? draft.activeUnitId
      : next.units[0]?.id ?? null,
    undoStack: [...draft.undoStack, snapshotDraft(draft)],
    redoStack: draft.redoStack.slice(0, -1),
    lastEdit: undefined,
  }
}

export function getEditorDraftDiff(draft: EditorDraft): EditorUnitDiff[] {
  const before = new Map(draft.baseline.map((unit, index) => [unit.id, { unit, index }]))
  const after = new Map(draft.units.map((unit, index) => [unit.id, { unit, index }]))

  // Surviving chapters present in both baseline and current draft
  const survivingBefore = draft.baseline.filter((unit) => after.has(unit.id))
  const survivingAfter = draft.units.filter((unit) => before.has(unit.id))
  const survivingBeforeOrder = new Map(survivingBefore.map((unit, idx) => [unit.id, idx]))
  const survivingAfterOrder = new Map(survivingAfter.map((unit, idx) => [unit.id, idx]))

  const ids = new Set([...before.keys(), ...after.keys()])
  const diffs: EditorUnitDiff[] = []

  for (const id of ids) {
    const beforeEntry = before.get(id) ?? null
    const afterEntry = after.get(id) ?? null
    const original = beforeEntry?.unit ?? null
    const current = afterEntry?.unit ?? null

    // Case 1: Brand new chapter added
    if (!original && current) {
      diffs.push({
        id,
        before: null,
        after: current,
        titleChanged: false,
        contentChanged: false,
        levelChanged: false,
        orderChanged: false,
        beforeIndex: null,
        afterIndex: afterEntry?.index ?? null,
      })
      continue
    }

    // Case 2: Existing chapter deleted
    if (original && !current) {
      diffs.push({
        id,
        before: original,
        after: null,
        titleChanged: false,
        contentChanged: false,
        levelChanged: false,
        orderChanged: false,
        beforeIndex: beforeEntry?.index ?? null,
        afterIndex: null,
      })
      continue
    }

    // Case 3: Surviving chapter (exists in both)
    if (original && current) {
      const levelChanged = (original.level ?? 0) !== (current.level ?? 0)
      const titleChanged = current.titleChanged ?? original.title !== current.title
      const contentChanged = current.contentChanged ?? original.content !== current.content
      // Order changed ONLY if relative order among surviving chapters has shifted
      const orderChanged = survivingBeforeOrder.get(id) !== survivingAfterOrder.get(id)

      if (!titleChanged && !contentChanged && !levelChanged && !orderChanged) continue

      diffs.push({
        id,
        before: original,
        after: current,
        titleChanged,
        contentChanged,
        levelChanged,
        orderChanged,
        beforeIndex: beforeEntry?.index ?? null,
        afterIndex: afterEntry?.index ?? null,
      })
    }
  }
  return diffs
}

export function discardEditorDraft(draft: EditorDraft): EditorDraft {
  const restored = snapshot(draft.baseline)
  return {
    ...draft,
    units: restored,
    tocRuleSelection: selectionSnapshot(draft.baselineTocRuleSelection),
    activeUnitId: restored.some((unit) => unit.id === draft.activeUnitId)
      ? draft.activeUnitId
      : restored[0]?.id ?? null,
    undoStack: [],
    redoStack: [],
    lastEdit: undefined,
  }
}
