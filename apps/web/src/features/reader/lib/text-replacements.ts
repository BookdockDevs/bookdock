import { applyPointMatch, applyRuleToRuns, countRuleInText, findPointMatch, type TextRun } from '@bookdock/shared'
import type { TextReplacementRes } from '@bookdock/shared'

// Only the fields the renderer needs; the API rows satisfy this structurally.
export type TextReplacementRule = Pick<
  TextReplacementRes,
  | 'id'
  | 'matchType'
  | 'pattern'
  | 'replacement'
  | 'isRegex'
  | 'applyTo'
  | 'enabled'
  | 'effectiveEnabled'
  | 'spineHref'
  | 'textOffset'
  | 'originalText'
>

// HEAD is skipped because its <title> duplicates the visible heading text in
// generated EPUB chapters — counting/replacing it would double every title hit
// while being invisible in the reader viewport.
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD'])
const TITLE_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TITLE'])

// EPUB chapters are parsed as application/xhtml+xml (strict XML), where tagName
// keeps its lowercase source form; HTML parsing uppercases it. Match tags
// case-insensitively so both parse modes treat the same elements as titles.
function hasTag(tags: Set<string>, el: Element): boolean {
  return tags.has(el.tagName.toUpperCase())
}

// Collect the section's text nodes in document order, skipping script/style
// subtrees — the single traversal shared by the engine and the creation-side
// offset computation, so both sides count the same characters.
function collectTextNodes(doc: Document): Text[] {
  const nodes: Text[] = []
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes.filter((n) => {
    let ancestor = n.parentElement
    while (ancestor) {
      if (hasTag(SKIPPED_TAGS, ancestor)) return false
      ancestor = ancestor.parentElement
    }
    return true
  })
}

// Character offset of the selection start within the section's text content
// (the concatenation collectTextNodes counts). P2 point-patch anchor: the
// stored textOffset must land in the same coordinate system the engine
// searches, and the iframe document at selection time is the transformed text
// (Chinese conversion is length-preserving, so offsets carry over).
export function textContentOffset(doc: Document, target: Text, localOffset: number): number | null {
  let offset = 0
  for (const node of collectTextNodes(doc)) {
    if (node === target) return offset + localOffset
    offset += node.nodeValue?.length ?? 0
  }
  return null
}

/**
 * Resolve a point-patch replacement to a live range using the same text-node
 * coordinate system as textOffset. The replacement may appear more than once,
 * so the occurrence nearest the stored anchor wins.
 */
export function textContentRangeNearOffset(doc: Document, text: string, textOffset: number): Range | null {
  const nodes = collectTextNodes(doc)
  if (!doc.body || nodes.length === 0 || textOffset < 0) return null

  const runs = nodes.map((node) => ({ text: node.nodeValue ?? '' }))
  if (text) {
    const match = findPointMatch(runs, text, textOffset)
    if (match) {
      const range = doc.createRange()
      range.setStart(nodes[match.runIndex]!, match.local)
      range.setEnd(nodes[match.endRunIndex]!, match.endLocal)
      return range
    }
  }

  const contentLength = runs.reduce((total, run) => total + run.text.length, 0)
  if (contentLength === 0) return null
  const startOffset = Math.min(textOffset, contentLength - 1)
  const endOffset = Math.min(contentLength, startOffset + Math.max(1, Math.min(text.length, 80)))
  let cursor = 0
  let start: { node: Text; offset: number } | null = null
  let end: { node: Text; offset: number } | null = null
  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0
    if (!start && startOffset < cursor + length) start = { node, offset: startOffset - cursor }
    if (!end && endOffset <= cursor + length) end = { node, offset: endOffset - cursor }
    cursor += length
    if (start && end) break
  }
  if (!start || !end) return null
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

// Point patches (P2): snapshot-anchored single-spot edits. Run after pattern
// rules on the same nodes. The shared findPointMatch searches the concatenated
// runs for the occurrence closest to the recorded textOffset; a match may span
// multiple text nodes, while applyPointMatch changes only their text content.
function applyPointPatches(
  nodes: Text[],
  patches: TextReplacementRule[],
  sectionHref: string,
  onInvalid?: (ids: string[]) => void,
): void {
  if (!patches.length) return
  const runs: TextRun[] = nodes.map((n) => ({ text: n.nodeValue ?? '' }))
  const invalid: string[] = []
  for (const patch of patches) {
    if (patch.spineHref !== sectionHref) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) {
      invalid.push(patch.id)
      continue
    }
    const found = findPointMatch(runs, snapshot, patch.textOffset)
    if (!found) {
      invalid.push(patch.id)
      continue
    }
    applyPointMatch(runs, found, patch.replacement ?? '')
    for (let i = found.runIndex; i <= found.endRunIndex; i++) nodes[i]!.nodeValue = runs[i]!.text
  }
  if (invalid.length) onInvalid?.(invalid)
}

// Tags, attributes and script/style contents are never touched. Content rules
// operate on one logical section stream, while title rules operate on each
// heading independently so inline markup can be crossed without joining
// separate paragraphs or headings.
export function applyReplacements(
  html: string,
  rules: TextReplacementRule[],
  docType: DOMParserSupportedType = 'text/html',
  sectionHref?: string,
  onInvalid?: (ids: string[]) => void,
): string {
  // effectiveEnabled is the per-book value after applying overrides (present on
  // book-scoped queries); enabled is the global default fallback.
  const activePatterns = rules.filter((r) =>
    (r.effectiveEnabled ?? r.enabled)
    && r.matchType === 'pattern'
    && r.pattern
  )
  const activePoints = sectionHref
    ? rules.filter((r) => (r.effectiveEnabled ?? r.enabled) && r.matchType === 'point')
    : []
  if (!activePatterns.length && !activePoints.length) return html
  const doc = parseReplacementDocument(html, docType)
  if (!doc) return html
  return rewriteReplacementDocument(doc, activePatterns, activePoints, sectionHref, onInvalid, applyPatternRules)
}

/**
 * Browser-safe variant used by the reader. Regexes execute in a worker so a
 * pathological backtracking pattern cannot freeze pagination or the toolbar.
 * Literal rules keep the synchronous fast path when no regex is present.
 */
export async function applyReplacementsWithWorker(
  html: string,
  rules: TextReplacementRule[],
  docType: DOMParserSupportedType = 'text/html',
  sectionHref?: string,
  onInvalid?: (ids: string[]) => void,
): Promise<string> {
  const activePatterns = rules.filter((r) =>
    (r.effectiveEnabled ?? r.enabled)
    && r.matchType === 'pattern'
    && r.pattern
  )
  const activePoints = sectionHref
    ? rules.filter((r) => (r.effectiveEnabled ?? r.enabled) && r.matchType === 'point')
    : []
  if (!activePatterns.length && !activePoints.length) return html
  const doc = parseReplacementDocument(html, docType)
  if (!doc) return html
  const regexRules = activePatterns.filter((rule) => rule.isRegex)
  const contentRules = activePatterns.filter((rule) => rule.applyTo !== 'title')
  if (!regexRules.length || typeof Worker === 'undefined') {
    return rewriteReplacementDocument(doc, activePatterns, activePoints, sectionHref, onInvalid, applyPatternRules)
  }

  const nodes = collectTextNodes(doc)
  const contentNodeIndexes = nodes
    .map((node, index) => isTitleTextNode(node) ? -1 : index)
    .filter((index) => index >= 0)
  const contentRuns = contentNodeIndexes.map((index) => ({ text: nodes[index]!.nodeValue ?? '' }))
  const transformedRuns = await runPatternWorker(contentRuns, contentRules)
  for (let i = 0; i < contentNodeIndexes.length; i++) nodes[contentNodeIndexes[i]!]!.nodeValue = transformedRuns[i]!.text
  applyTitleRules(nodes, activePatterns.filter((rule) => rule.applyTo !== 'content'))
  if (sectionHref) applyPointPatches(nodes, activePoints, sectionHref, onInvalid)
  return new XMLSerializer().serializeToString(doc)
}

async function runPatternWorker(runs: TextRun[], rules: TextReplacementRule[]): Promise<TextRun[]> {
  const safeRules = rules.filter((rule) => rule.applyTo !== 'title')
  if (!safeRules.length) return runs
  const worker = new Worker(new URL('./text-replacement.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: TextRun[]) => {
      if (settled) return
      settled = true
      worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => {
      // A timed-out regex rule is skipped as a safety boundary. Do not retry it
      // on the UI thread, because that would defeat the point of the worker.
      const literalRules = safeRules.filter((rule) => !rule.isRegex)
      const fallback = runs.map((run) => ({ ...run }))
      applyPatternRules(fallback, literalRules)
      clearTimeout(timer)
      finish(fallback)
    }, 3000)
    worker.onmessage = (event: MessageEvent<{ runs?: TextRun[] }>) => {
      clearTimeout(timer)
      finish(event.data.runs ?? runs)
    }
    worker.onerror = () => {
      clearTimeout(timer)
      const fallback = runs.map((run) => ({ ...run }))
      applyPatternRules(fallback, safeRules.filter((rule) => !rule.isRegex))
      finish(fallback)
    }
    worker.postMessage({ runs, rules: safeRules })
  })
}

// Match counts per pattern rule for one section's markup — the same traversal
// and matching semantics as applyReplacements, so "N 处" tells the user how many
// spots a rule would hit. Each rule is counted independently against the
// original text: sequential interactions between rules (one rule matching text
// produced by an earlier replacement) are ignored, a deliberate approximation.
export function countPatternMatches(
  html: string,
  rules: TextReplacementRule[],
  docType: DOMParserSupportedType = 'text/html',
): Record<string, number> {
  const active = rules.filter((r) => r.matchType === 'pattern' && r.pattern && r.id)
  if (!active.length) return {}
  const counts = Object.fromEntries(active.map((r) => [r.id, 0]))
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, docType)
  } catch {
    return counts
  }
  if (doc.querySelector('parsererror')) return counts
  const nodes = collectTextNodes(doc)
  const contentText = nodes.filter((node) => !isTitleTextNode(node)).map((node) => node.nodeValue ?? '').join('')
  const titleTexts = new Map<Element, string>()
  for (const node of nodes) {
    if (!isTitleTextNode(node)) continue
    let title = node.parentElement
    while (title && !hasTag(TITLE_TAGS, title)) title = title.parentElement
    if (!title) continue
    titleTexts.set(title, `${titleTexts.get(title) ?? ''}${node.nodeValue ?? ''}`)
  }
  for (const rule of active) {
    if (rule.applyTo !== 'title') counts[rule.id] = (counts[rule.id] ?? 0) + countRuleInText(contentText, rule)
    if (rule.applyTo !== 'content') {
      for (const text of titleTexts.values()) counts[rule.id] = (counts[rule.id] ?? 0) + countRuleInText(text, rule)
    }
  }
  return counts
}

function isTitleTextNode(node: Text): boolean {
  let ancestor = node.parentElement
  while (ancestor) {
    if (hasTag(TITLE_TAGS, ancestor)) return true
    ancestor = ancestor.parentElement
  }
  return false
}

function applyTitleRules(nodes: Text[], rules: TextReplacementRule[]): void {
  const groups = new Map<Element, Text[]>()
  for (const node of nodes) {
    let title = node.parentElement
    while (title && !hasTag(TITLE_TAGS, title)) title = title.parentElement
    if (!title) continue
    const group = groups.get(title) ?? []
    group.push(node)
    groups.set(title, group)
  }
  for (const nodesInTitle of groups.values()) {
    const runs = nodesInTitle.map((node) => ({ text: node.nodeValue ?? '' }))
    for (const rule of rules) {
      try {
        applyRuleToRuns(runs, rule)
      } catch {
        // A single unsupported or invalid rule must not block the chapter.
      }
    }
    for (let i = 0; i < nodesInTitle.length; i++) nodesInTitle[i]!.nodeValue = runs[i]!.text
  }
}

function applyPatternRules(runs: TextRun[], rules: TextReplacementRule[]): void {
  for (const rule of rules) {
    try {
      applyRuleToRuns(runs, rule)
    } catch {
      // A single unsupported or invalid rule must not block the chapter.
    }
  }
}

function parseReplacementDocument(html: string, docType: DOMParserSupportedType): Document | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, docType)
  } catch {
    return null
  }
  if (doc.querySelector('parsererror')) return null
  return doc
}

function rewriteReplacementDocument(
  doc: Document,
  activePatterns: TextReplacementRule[],
  activePoints: TextReplacementRule[],
  sectionHref: string | undefined,
  onInvalid: ((ids: string[]) => void) | undefined,
  applyContentRules: (runs: TextRun[], rules: TextReplacementRule[]) => void,
): string {
  const nodes = collectTextNodes(doc)
  const contentNodeIndexes = nodes
    .map((node, index) => isTitleTextNode(node) ? -1 : index)
    .filter((index) => index >= 0)
  const contentRuns: TextRun[] = contentNodeIndexes.map((index) => ({ text: nodes[index]!.nodeValue ?? '' }))
  applyContentRules(contentRuns, activePatterns.filter((rule) => rule.applyTo !== 'title'))
  for (let i = 0; i < contentNodeIndexes.length; i++) nodes[contentNodeIndexes[i]!]!.nodeValue = contentRuns[i]!.text
  applyTitleRules(nodes, activePatterns.filter((rule) => rule.applyTo !== 'content'))
  if (sectionHref) applyPointPatches(nodes, activePoints, sectionHref, onInvalid)
  return new XMLSerializer().serializeToString(doc)
}
