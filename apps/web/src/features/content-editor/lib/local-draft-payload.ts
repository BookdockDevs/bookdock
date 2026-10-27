import { epubLocalDraftSchema, txtLocalDraftSchema, type EpubLocalDraft, type TxtLocalDraft } from '@bookdock/shared'
import type { EditorDraft, EditorUnit } from './editor-draft'
import type { EpubEditorDraftState } from './epub-editor-draft'

export const txtPayloadSchema = txtLocalDraftSchema
export type TxtPayload = TxtLocalDraft

export function serializeTxtDraft(draft: EditorDraft): TxtPayload {
  const baseline = new Map(draft.baseline.map((item) => [item.id, item]))
  return { units: draft.units.map((item) => {
    const original = baseline.get(item.id)
    return { id: item.id, ...(item.title !== original?.title ? { title: item.title } : {}), ...(item.content !== original?.content ? { content: item.content } : {}), level: item.level, structureOnlyTitle: item.structureOnlyTitle, titleChanged: item.titleChanged, contentChanged: item.contentChanged }
  }), tocRuleSelection: draft.tocRuleSelection, activeUnitId: draft.activeUnitId }
}

export function restoreTxtDraft(base: EditorDraft, payload: TxtPayload): EditorDraft | null {
  const original = new Map(base.baseline.map((item) => [item.id, item]))
  const units: EditorUnit[] = []
  for (const item of payload.units) {
    const previous = original.get(item.id)
    if ((!previous && (item.title === undefined || item.content === undefined))) return null
    units.push({ ...previous, ...item, title: item.title ?? previous!.title, content: item.content ?? previous!.content })
  }
  return { ...base, units, tocRuleSelection: payload.tocRuleSelection, activeUnitId: units.some((item) => item.id === payload.activeUnitId) ? payload.activeUnitId : units[0]?.id ?? null, undoStack: [], redoStack: [] }
}

export const epubPayloadSchema = epubLocalDraftSchema
export type EpubPayload = EpubLocalDraft

export function restoreEpubDraft(base: EpubEditorDraftState, payload: EpubPayload): EpubEditorDraftState | null {
  const changed = new Map(payload.documents.map((item) => [item.href, item.content]))
  if ([...changed.keys()].some((href) => !base.documents.some((item) => item.href === href))) return null
  if (payload.spineOrder.length !== base.spineOrder.length || new Set(payload.spineOrder).size !== base.spineOrder.length || payload.spineOrder.some((href) => !base.spineOrder.includes(href))) return null
  const hrefs = base.tocEntries.map((entry) => entry.href).sort()
  const restoredHrefs = payload.tocEntries.map((entry) => entry.href).sort()
  if (hrefs.length !== restoredHrefs.length || hrefs.some((href, index) => href !== restoredHrefs[index])) return null
  return { ...base, documents: base.documents.map((item) => changed.has(item.href) ? { ...item, content: changed.get(item.href)!, changed: changed.get(item.href) !== item.content } : item), tocEntries: payload.tocEntries, spineOrder: payload.spineOrder, undoStack: [], redoStack: [] }
}
