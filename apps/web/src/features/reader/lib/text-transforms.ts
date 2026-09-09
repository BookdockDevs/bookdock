import { applyPointMatch, applyRuleToText, countRuleInText, findPointMatch, type TextRun } from '@bookdock/shared'
import type { TextTransformRes } from '@bookdock/shared'

// Only the fields the renderer needs; the API rows satisfy this structurally.
export type TextTransformRule = Pick<
  TextTransformRes,
  | 'id'
  | 'matchType'
  | 'pattern'
  | 'replacement'
  | 'isRegex'
  | 'caseSensitive'
  | 'enabled'
  | 'effectiveEnabled'
  | 'spineHref'
  | 'textOffset'
  | 'originalText'
>

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE'])

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
      if (SKIPPED_TAGS.has(ancestor.tagName)) return false
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

// Point patches (P2): snapshot-anchored single-spot edits. Run after pattern
// rules on the same nodes. The shared findPointMatch searches the concatenated
// runs for the occurrence closest to the recorded textOffset; a match may span
// multiple text nodes, while applyPointMatch changes only their text content.
function applyPointPatches(
  nodes: Text[],
  patches: TextTransformRule[],
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
    const found = findPointMatch(runs, snapshot, patch.textOffset, patch.caseSensitive)
    if (!found) {
      invalid.push(patch.id)
      continue
    }
    applyPointMatch(runs, found, patch.replacement ?? '')
    for (let i = found.runIndex; i <= found.endRunIndex; i++) nodes[i]!.nodeValue = runs[i]!.text
  }
  if (invalid.length) onInvalid?.(invalid)
}

// Text-node-level rewrite: tags, attributes and script/style contents are
// never touched (unlike Chinese conversion, which has a closed mapping table
// and can afford whole-string replacement). Rules are written against the
// original text, so this runs BEFORE Chinese conversion in the data pipeline.
export function applyTransforms(
  html: string,
  rules: TextTransformRule[],
  docType: DOMParserSupportedType = 'text/html',
  sectionHref?: string,
  onInvalid?: (ids: string[]) => void,
): string {
  // effectiveEnabled is the per-book value after applying overrides (present on
  // book-scoped queries); enabled is the global default fallback.
  const activePatterns = rules.filter((r) => (r.effectiveEnabled ?? r.enabled) && r.matchType === 'pattern' && r.pattern)
  const activePoints = sectionHref
    ? rules.filter((r) => (r.effectiveEnabled ?? r.enabled) && r.matchType === 'point')
    : []
  if (!activePatterns.length && !activePoints.length) return html
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, docType)
  } catch {
    return html
  }
  // XML parsing reports malformed input as a parsererror element instead of
  // throwing — pass the original through rather than rendering the error.
  if (doc.querySelector('parsererror')) return html
  const nodes = collectTextNodes(doc)
  for (const textNode of nodes) {
    let text = textNode.nodeValue ?? ''
    for (const rule of activePatterns) text = applyRuleToText(text, rule)
    textNode.nodeValue = text
  }
  // activePoints is non-empty only when sectionHref was passed (see above)
  if (sectionHref) applyPointPatches(nodes, activePoints, sectionHref, onInvalid)
  return new XMLSerializer().serializeToString(doc)
}

// Match counts per pattern rule for one section's markup — the same traversal
// and matching semantics as applyTransforms, so "N 处" tells the user how many
// spots a rule would hit. Each rule is counted independently against the
// original text: sequential interactions between rules (one rule matching text
// produced by an earlier replacement) are ignored, a deliberate approximation.
export function countPatternMatches(
  html: string,
  rules: TextTransformRule[],
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
  for (const rule of active) {
    let total = 0
    for (const node of nodes) total += countRuleInText(node.nodeValue ?? '', rule)
    counts[rule.id] = total
  }
  return counts
}
