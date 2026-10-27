export interface EpubEditorDocument {
  href: string
  content: string
  changed?: boolean
}

export interface EpubEditorTocEntry {
  href: string
  title: string
  level: number
}

interface EpubEditorHistorySnapshot {
  documents: EpubEditorDocument[]
  tocEntries: EpubEditorTocEntry[]
  spineOrder: string[]
  weight: number
}

export interface EpubEditorDraftState {
  baseline: { documents: EpubEditorDocument[]; tocEntries: EpubEditorTocEntry[]; spineOrder: string[] }
  documents: EpubEditorDocument[]
  tocEntries: EpubEditorTocEntry[]
  spineOrder: string[]
  undoStack: EpubEditorHistorySnapshot[]
  redoStack: EpubEditorHistorySnapshot[]
  lastEdit?: { key: string; at: number }
}

type EpubEditorSnapshot = Pick<EpubEditorDraftState, 'documents' | 'tocEntries' | 'spineOrder'>

const HISTORY_BYTE_BUDGET = 48 * 1024 * 1024
const HISTORY_STEP_LIMIT = 100
const TYPING_MERGE_MS = 750

function snapshot(state: EpubEditorSnapshot): EpubEditorSnapshot {
  return {
    documents: state.documents.map((document) => ({ ...document })),
    tocEntries: state.tocEntries.map((entry) => ({ ...entry })),
    spineOrder: [...state.spineOrder],
  }
}

function historySnapshot(state: EpubEditorSnapshot, baseline: EpubEditorSnapshot): EpubEditorHistorySnapshot {
  const copy = snapshot(state)
  const baselineDocuments = new Map(baseline.documents.map((document) => [document.href, document]))
  const baselineEntries = new Map(baseline.tocEntries.map((entry) => [entry.href, entry]))
  const documentWeight = copy.documents.reduce((sum, document) => {
    const original = baselineDocuments.get(document.href)
    return sum + 64 + (original ? document.content === original.content ? 0 : document.content.length * 2 : (document.href.length + document.content.length) * 2)
  }, 0)
  const tocWeight = copy.tocEntries.reduce((sum, entry) => {
    const original = baselineEntries.get(entry.href)
    return sum + 48 + (original ? entry.title === original.title ? 0 : entry.title.length * 2 : (entry.href.length + entry.title.length) * 2)
  }, 0)
  return { ...copy, weight: documentWeight + tocWeight + copy.spineOrder.length * 8 + 64 }
}

function boundHistory(undoStack: EpubEditorHistorySnapshot[], redoStack: EpubEditorHistorySnapshot[]) {
  let total = [...undoStack, ...redoStack].reduce((sum, entry) => sum + entry.weight, 0)
  while (undoStack.length + redoStack.length > HISTORY_STEP_LIMIT || total > HISTORY_BYTE_BUDGET) {
    const undo = undoStack[0]
    const redo = redoStack[0]
    if (!undo && !redo) break
    const removeUndo = !redo || (!!undo && undo.weight <= redo.weight)
    total -= removeUndo ? undoStack.shift()!.weight : redoStack.shift()!.weight
  }
  return { undoStack, redoStack }
}

function pushUndo(state: EpubEditorDraftState, next: EpubEditorSnapshot, coalesceKey?: string, knownChanged = false): EpubEditorDraftState {
  if (!knownChanged && state.documents.length === next.documents.length && state.tocEntries.length === next.tocEntries.length
    && state.spineOrder.length === next.spineOrder.length
    && state.documents.every((item, index) => item.href === next.documents[index]?.href && item.content === next.documents[index]?.content)
    && state.tocEntries.every((item, index) => item.href === next.tocEntries[index]?.href && item.title === next.tocEntries[index]?.title && item.level === next.tocEntries[index]?.level)
    && state.spineOrder.every((href, index) => href === next.spineOrder[index])) return state
  const now = Date.now()
  const coalesce = coalesceKey && state.lastEdit?.key === coalesceKey && now - state.lastEdit.at <= TYPING_MERGE_MS
  return {
    ...state,
    ...snapshot(next),
    ...boundHistory(coalesce ? [...state.undoStack] : [...state.undoStack, historySnapshot(state, state.baseline)], []),
    lastEdit: coalesceKey ? { key: coalesceKey, at: now } : undefined,
  }
}

export function endEpubEditorEditGroup(state: EpubEditorDraftState): EpubEditorDraftState {
  return state.lastEdit ? { ...state, lastEdit: undefined } : state
}

export function createEpubEditorDraft(input: EpubEditorSnapshot): EpubEditorDraftState {
  const initial = snapshot(input)
  return { baseline: snapshot(initial), ...snapshot(initial), undoStack: [], redoStack: [] }
}

export function editEpubDocument(state: EpubEditorDraftState, href: string, content: string): EpubEditorDraftState {
  const current = state.documents.find((document) => document.href === href)
  const baseline = state.baseline.documents.find((document) => document.href === href)
  if (!current || !baseline || current.content === content) return state
  return pushUndo(state, {
    ...state,
    documents: state.documents.map((document) => document.href === href ? { ...document, content, changed: content !== baseline.content } : document),
  }, `document:${href}`, true)
}

export function editEpubTocEntry(
  state: EpubEditorDraftState,
  index: number,
  change: Partial<Pick<EpubEditorTocEntry, 'title' | 'level'>>,
): EpubEditorDraftState {
  return pushUndo(state, {
    ...state,
    tocEntries: normalizeTocLevels(state.tocEntries.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, ...change, level: change.level ?? entry.level }
      : entry)),
  })
}

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const result = [...items]
  const current = result[index]!
  result[index] = result[target]!
  result[target] = current
  return result
}

function normalizeTocLevels(entries: EpubEditorTocEntry[]): EpubEditorTocEntry[] {
  let previousLevel = 0
  return entries.map((entry) => {
    const level = Math.max(1, Math.min(entry.level, previousLevel + 1, 20))
    previousLevel = level
    return { ...entry, level }
  })
}

export function moveEpubTocEntry(state: EpubEditorDraftState, index: number, delta: -1 | 1): EpubEditorDraftState {
  return pushUndo(state, { ...state, tocEntries: normalizeTocLevels(move(state.tocEntries, index, delta)) })
}

export function getEpubTocSubtreeEnd(entries: EpubEditorTocEntry[], index: number): number {
  const level = entries[index]?.level
  if (level === undefined) return index + 1
  let end = index + 1
  while (end < entries.length && entries[end]!.level > level) end += 1
  return end
}

export function moveEpubTocSelection(
  state: EpubEditorDraftState,
  selectedIndices: readonly number[],
  destinationIndex: number | null,
  placement: 'before' | 'after' | 'end',
): EpubEditorDraftState {
  const entries = state.tocEntries
  const selected = [...new Set(selectedIndices)].filter((index) => index >= 0 && index < entries.length).sort((a, b) => a - b)
  if (selected.length === 0) return state
  const roots = selected.filter((index) => !selected.some((candidate) => candidate < index && getEpubTocSubtreeEnd(entries, candidate) > index))
  const groups = roots.map((index) => entries.slice(index, getEpubTocSubtreeEnd(entries, index)))
  const movingIndices = new Set(roots.flatMap((index) => Array.from({ length: getEpubTocSubtreeEnd(entries, index) - index }, (_, offset) => index + offset)))
  if (destinationIndex !== null && movingIndices.has(destinationIndex)) return state
  const remaining = entries.filter((_, index) => !movingIndices.has(index))
  const insertionBoundary = placement === 'end'
    ? entries.length
    : placement === 'after'
      ? getEpubTocSubtreeEnd(entries, destinationIndex!)
      : destinationIndex!
  const insertionIndex = entries.slice(0, insertionBoundary).filter((_, index) => !movingIndices.has(index)).length
  const targetLevel = placement === 'end' ? 1 : entries[destinationIndex!]!.level
  const moved = groups.flatMap((group) => {
    const levelShift = targetLevel - group[0]!.level
    return group.map((entry) => ({ ...entry, level: Math.max(1, Math.min(20, entry.level + levelShift)) }))
  })
  return pushUndo(state, {
    ...state,
    tocEntries: normalizeTocLevels([...remaining.slice(0, insertionIndex), ...moved, ...remaining.slice(insertionIndex)]),
  })
}

export function adjustEpubTocSelectionLevel(
  state: EpubEditorDraftState,
  selectedIndices: readonly number[],
  delta: -1 | 1,
): EpubEditorDraftState {
  const entries = state.tocEntries
  const selected = [...new Set(selectedIndices)].filter((index) => index >= 0 && index < entries.length).sort((a, b) => a - b)
  const roots = selected.filter((index) => !selected.some((candidate) => candidate < index && getEpubTocSubtreeEnd(entries, candidate) > index))
  const next = entries.map((entry) => ({ ...entry }))
  for (const root of roots) {
    const end = getEpubTocSubtreeEnd(entries, root)
    const levelShift = Math.max(1 - entries[root]!.level, Math.min(delta, 20 - entries[end - 1]!.level))
    for (let index = root; index < end; index += 1) next[index]!.level += levelShift
  }
  return pushUndo(state, { ...state, tocEntries: normalizeTocLevels(next) })
}

export function moveEpubSpineDocument(state: EpubEditorDraftState, href: string, delta: -1 | 1): EpubEditorDraftState {
  const index = state.spineOrder.indexOf(href)
  if (index < 0) return state
  return pushUndo(state, { ...state, spineOrder: move(state.spineOrder, index, delta) })
}

export function reorderEpubSpineDocument(state: EpubEditorDraftState, href: string, targetHref: string): EpubEditorDraftState {
  const from = state.spineOrder.indexOf(href)
  const to = state.spineOrder.indexOf(targetHref)
  if (from < 0 || to < 0 || from === to) return state
  const spineOrder = [...state.spineOrder]
  spineOrder.splice(from, 1)
  spineOrder.splice(to, 0, href)
  return pushUndo(state, { ...state, spineOrder })
}

export function undoEpubEditorDraft(state: EpubEditorDraftState): EpubEditorDraftState {
  const previous = state.undoStack.at(-1)
  if (!previous) return state
  const history = boundHistory(state.undoStack.slice(0, -1), [...state.redoStack, historySnapshot(state, state.baseline)])
  return { ...state, ...snapshot(previous), ...history, lastEdit: undefined }
}

export function redoEpubEditorDraft(state: EpubEditorDraftState): EpubEditorDraftState {
  const next = state.redoStack.at(-1)
  if (!next) return state
  const history = boundHistory([...state.undoStack, historySnapshot(state, state.baseline)], state.redoStack.slice(0, -1))
  return { ...state, ...snapshot(next), ...history, lastEdit: undefined }
}

export function hasEpubEditorChanges(state: EpubEditorDraftState): boolean {
  return state.documents.length !== state.baseline.documents.length
    || state.documents.some((item, index) => item.href !== state.baseline.documents[index]?.href || item.changed === true)
    || state.tocEntries.length !== state.baseline.tocEntries.length
    || state.tocEntries.some((item, index) => item.href !== state.baseline.tocEntries[index]?.href
      || item.title !== state.baseline.tocEntries[index]?.title || item.level !== state.baseline.tocEntries[index]?.level)
    || state.spineOrder.length !== state.baseline.spineOrder.length
    || state.spineOrder.some((href, index) => href !== state.baseline.spineOrder[index])
}

