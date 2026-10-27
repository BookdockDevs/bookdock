import type { EpubEditorDocument, EpubEditorDraftState, EpubEditorTocEntry } from './epub-editor-draft'
import { extractEpubVisibleText } from './epub-document-adapter'

export interface EpubEditorTextChange {
  before: string
  after: string
}

export interface EpubEditorDocumentDiff {
  id: string
  href: string
  before: EpubEditorDocument | null
  after: EpubEditorDocument | null
  textChange: EpubEditorTextChange | null
}

export interface EpubEditorTocDiff {
  id: string
  before: EpubEditorTocEntry | null
  after: EpubEditorTocEntry | null
}

export interface EpubEditorOrderDiff {
  id: string
  href: string
  beforeIndex: number
  afterIndex: number
}

export interface EpubEditorDiff {
  documents: EpubEditorDocumentDiff[]
  tocEntries: EpubEditorTocDiff[]
  tocReordered: boolean
  spineReordered: boolean
  tocOrderChanges: EpubEditorOrderDiff[]
  spineOrderChanges: EpubEditorOrderDiff[]
  changeCount: number
}

function occurrenceIds<T>(items: T[], getHref: (item: T) => string): string[] {
  const counts = new Map<string, number>()
  return items.map((item) => {
    const href = getHref(item)
    const occurrence = counts.get(href) ?? 0
    counts.set(href, occurrence + 1)
    return `${href}\u0000${occurrence}`
  })
}

function matchTocOccurrences(baseline: EpubEditorTocEntry[], current: EpubEditorTocEntry[]): { baselineIds: string[]; currentIds: string[] } {
  const baselineIds = new Array<string>(baseline.length)
  const currentIds = new Array<string>(current.length)
  const baselineByHref = new Map<string, number[]>()
  const currentByHref = new Map<string, number[]>()
  const addIndex = (groups: Map<string, number[]>, href: string, index: number) => {
    const indexes = groups.get(href) ?? []
    indexes.push(index)
    groups.set(href, indexes)
  }
  baseline.forEach((entry, index) => addIndex(baselineByHref, entry.href, index))
  current.forEach((entry, index) => addIndex(currentByHref, entry.href, index))
  const hrefs = new Set([...baselineByHref.keys(), ...currentByHref.keys()])
  for (const href of hrefs) {
    const beforeIndexes = baselineByHref.get(href) ?? []
    const afterIndexes = currentByHref.get(href) ?? []
    const matchedBefore = new Set<number>()
    const matchedAfter = new Set<number>()
    const currentByTitleLevel = new Map<string, number[]>()
    for (const index of afterIndexes) {
      const entry = current[index]!
      const key = JSON.stringify([entry.title, entry.level])
      const indexes = currentByTitleLevel.get(key) ?? []
      indexes.push(index)
      currentByTitleLevel.set(key, indexes)
    }
    const titleLevelCursors = new Map<string, number>()
    let occurrence = 0
    const identityFor = () => `${href}\u0000${occurrence++}`

    for (const beforeIndex of beforeIndexes) {
      const before = baseline[beforeIndex]!
      const key = JSON.stringify([before.title, before.level])
      const exactMatches = currentByTitleLevel.get(key)
      const cursor = titleLevelCursors.get(key) ?? 0
      const exactIndex = exactMatches?.[cursor]
      if (exactIndex === undefined) continue
      titleLevelCursors.set(key, cursor + 1)
      const id = identityFor()
      baselineIds[beforeIndex] = id
      currentIds[exactIndex] = id
      matchedBefore.add(beforeIndex)
      matchedAfter.add(exactIndex)
    }

    const remainingBefore = beforeIndexes.filter((index) => !matchedBefore.has(index))
    const remainingAfter = afterIndexes.filter((index) => !matchedAfter.has(index))
    const paired = Math.min(remainingBefore.length, remainingAfter.length)
    for (let index = 0; index < paired; index += 1) {
      const id = identityFor()
      baselineIds[remainingBefore[index]!] = id
      currentIds[remainingAfter[index]!] = id
    }
    for (const index of remainingBefore.slice(paired)) baselineIds[index] = `${href}\u0000before${index}`
    for (const index of remainingAfter.slice(paired)) currentIds[index] = `${href}\u0000after${index}`
  }
  return { baselineIds, currentIds }
}

function relativeOrderChanged(before: string[], after: string[]): boolean {
  const afterSet = new Set(after)
  const common = new Set(before.filter((id) => afterSet.has(id)))
  if (common.size < 2) return false
  const beforeCommon = before.filter((id) => common.has(id))
  const afterCommon = after.filter((id) => common.has(id))
  return beforeCommon.some((id, index) => afterCommon[index] !== id)
}

function changedOrderEntries(before: string[], after: string[]): EpubEditorOrderDiff[] {
  if (!relativeOrderChanged(before, after)) return []
  const afterIndexById = new Map(after.map((id, index) => [id, index]))
  const beforeIndexById = new Map(before.map((id, index) => [id, index]))
  const afterSet = new Set(after)
  const common = new Set(before.filter((id) => afterSet.has(id)))
  const beforeRanks = new Map(before.filter((id) => common.has(id)).map((id, index) => [id, index]))
  const afterRanks = new Map(after.filter((id) => common.has(id)).map((id, index) => [id, index]))
  return before.filter((id) => common.has(id) && beforeRanks.get(id) !== afterRanks.get(id)).map((id) => ({
    id,
    href: id.slice(0, id.lastIndexOf('\u0000')),
    beforeIndex: beforeIndexById.get(id)!,
    afterIndex: afterIndexById.get(id)!,
  }))
}

function localTextChange(before: string, after: string): EpubEditorTextChange {
  let prefix = 0
  const shortest = Math.min(before.length, after.length)
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1

  let suffix = 0
  while (suffix < shortest - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1

  const context = 80
  const excerpt = (text: string, endOfChangedRegion: number) => {
    const start = Math.max(0, prefix - context)
    const end = Math.min(text.length, endOfChangedRegion + context)
    if (end - start <= 400) return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    const leftEnd = start + 180
    const rightStart = end - 180
    const omitted = rightStart - leftEnd
    return `${start > 0 ? '…' : ''}${text.slice(start, leftEnd)}…（中间省略 ${omitted} 字）…${text.slice(rightStart, end)}${end < text.length ? '…' : ''}`
  }
  return {
    before: excerpt(before, before.length - suffix),
    after: excerpt(after, after.length - suffix),
  }
}

function visibleText(document: EpubEditorDocument | null): string {
  if (!document) return ''
  return extractEpubVisibleText(document.content)
}

export function getEpubEditorDiff(draft: EpubEditorDraftState, includeText = true): EpubEditorDiff {
  const baselineDocIds = occurrenceIds(draft.baseline.documents, (doc) => doc.href)
  const currentDocIds = occurrenceIds(draft.documents, (doc) => doc.href)
  const baselineDocuments = new Map(baselineDocIds.map((id, index) => [id, draft.baseline.documents[index]!]))
  const currentDocuments = new Map(currentDocIds.map((id, index) => [id, draft.documents[index]!]))
  const documentIds = [...baselineDocIds, ...currentDocIds.filter((id) => !baselineDocuments.has(id))]
  const documents = documentIds.flatMap((id) => {
    const before = baselineDocuments.get(id) ?? null
    const after = currentDocuments.get(id) ?? null
    if (before?.content === after?.content) return []
    const beforeText = includeText ? visibleText(before) : ''
    const afterText = includeText ? visibleText(after) : ''
    return [{
      id,
      href: after?.href ?? before!.href,
      before,
      after,
      textChange: !includeText || beforeText === afterText ? null : localTextChange(beforeText, afterText),
    }]
  })

  const { baselineIds: baselineTocIds, currentIds: currentTocIds } = matchTocOccurrences(draft.baseline.tocEntries, draft.tocEntries)
  const baselineToc = new Map(baselineTocIds.map((id, index) => [id, draft.baseline.tocEntries[index]!]))
  const currentToc = new Map(currentTocIds.map((id, index) => [id, draft.tocEntries[index]!]))
  const tocIds = [...baselineTocIds, ...currentTocIds.filter((id) => !baselineToc.has(id))]
  const tocEntries = tocIds.flatMap((id) => {
    const before = baselineToc.get(id) ?? null
    const after = currentToc.get(id) ?? null
    if (before && after && before.title === after.title && before.level === after.level) return []
    return [{ id, before, after }]
  })
  const tocReordered = relativeOrderChanged(baselineTocIds, currentTocIds)
  const spineIdsBefore = occurrenceIds(draft.baseline.spineOrder, (href) => href)
  const spineIdsAfter = occurrenceIds(draft.spineOrder, (href) => href)
  const spineReordered = relativeOrderChanged(spineIdsBefore, spineIdsAfter)
  const tocOrderChanges = changedOrderEntries(baselineTocIds, currentTocIds)
  const spineOrderChanges = changedOrderEntries(spineIdsBefore, spineIdsAfter)

  return {
    documents,
    tocEntries,
    tocReordered,
    spineReordered,
    tocOrderChanges,
    spineOrderChanges,
    changeCount: documents.length + tocEntries.length + Number(tocReordered) + Number(spineReordered),
  }
}
