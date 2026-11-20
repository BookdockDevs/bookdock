// Pure text-highlight matching core (phase 3). No DOM access: the worker and
// the editor preview both execute these functions, so preview and real
// chapters share the exact same matching and priority semantics.
//
// Matches always carry exact offsets (regex exec positions, never substring
// re-search), zero-length matches are skipped, and boundaries snap outward so
// surrogate pairs are never split.

import type { HighlightRuleDef, HighlightRuleLine, HighlightRuleStyle } from '@bookdock/shared'

/** Resolved line effect: `undefined` = not set, `null` = explicitly no line. */
export type HighlightLineEffect = HighlightRuleLine | null | undefined

export interface HighlightSegment {
  start: number
  end: number
  textColor?: string
  backgroundColor?: string
  line?: HighlightRuleLine
}

export interface HighlightSpan {
  start: number
  end: number
  order: number
  /** null = the rule's whole-match span */
  groupIndex: number | null
  style: HighlightRuleStyle
}

export const HIGHLIGHT_LIMITS = {
  maxRules: 64,
  maxPatternLength: 300,
  maxSampleLength: 4000,
  maxGroups: 32,
  maxMatchesPerRule: 200,
  maxMatchesPerParagraph: 2000,
  maxParagraphLength: 20000,
  maxSpansPerParagraph: 4000,
} as const

/**
 * Compile a user regex with unicode + global flags; null when invalid. The
 * `d` (hasIndices) flag supplies exact capture-group offsets — engines that
 * predate it compile without it and group styles then produce no spans.
 */
export function compileHighlightRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gud')
  } catch {
    try {
      return new RegExp(pattern, 'gu')
    } catch {
      return null
    }
  }
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
}

// A regex without the `u` flag may start or end inside a surrogate pair; snap
// the boundary outward so every drawn Range keeps whole characters.
function snapSpan(text: string, span: { start: number; end: number }): void {
  while (span.start > 0 && isLowSurrogate(text.charCodeAt(span.start)) && isHighSurrogate(text.charCodeAt(span.start - 1))) span.start--
  while (span.end < text.length && isHighSurrogate(text.charCodeAt(span.end - 1)) && isLowSurrogate(text.charCodeAt(span.end))) span.end++
}

interface RawMatch {
  start: number
  end: number
  /** Per capture group [start, end]; null = group did not participate */
  groups: Array<[number, number] | null>
}

function matchLiteralRule(text: string, pattern: string): RawMatch[] {
  const matches: RawMatch[] = []
  let from = 0
  while (matches.length < HIGHLIGHT_LIMITS.maxMatchesPerRule && from <= text.length - pattern.length) {
    const start = text.indexOf(pattern, from)
    if (start < 0) break
    matches.push({ start, end: start + pattern.length, groups: [] })
    from = start + pattern.length
  }
  return matches
}

function matchRegexRule(text: string, regex: RegExp): RawMatch[] {
  const matches: RawMatch[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    if (match[0].length > 0) {
      const indices = match.indices
      const groupCount = Math.min(match.length - 1, HIGHLIGHT_LIMITS.maxGroups)
      const groups: Array<[number, number] | null> = []
      for (let g = 1; g <= groupCount; g++) {
        const index = indices?.[g]
        groups.push(index ? [index[0]!, index[1]!] : null)
      }
      matches.push({ start: match.index, end: match.index + match[0].length, groups })
      if (matches.length >= HIGHLIGHT_LIMITS.maxMatchesPerRule) break
    }
    // Zero-length matches advance so the loop cannot spin; they are not drawn.
    if (match[0].length === 0) {
      const point = text.codePointAt(regex.lastIndex)
      regex.lastIndex += point !== undefined && point > 0xffff ? 2 : 1
    }
  }
  return matches
}

function normalizePatternMatch(text: string, match: RawMatch): RawMatch | null {
  const span = { start: match.start, end: match.end }
  snapSpan(text, span)
  if (span.end <= span.start) return null
  const groups = match.groups.map((group) => {
    if (!group) return null
    const snapped = { start: group[0], end: group[1] }
    snapSpan(text, snapped)
    return snapped.end > snapped.start ? [snapped.start, snapped.end] as [number, number] : null
  })
  return { start: span.start, end: span.end, groups }
}

interface RuleExecution {
  matches: RawMatch[]
}

/**
 * Run one rule against one paragraph. A rule that fails to compile (or a
 * regex that throws mid-run) yields no matches — an invalid rule only
 * disables itself, the remaining rules still apply.
 */
export function matchRuleInParagraph(text: string, rule: HighlightRuleDef): RuleExecution {
  if (!rule.pattern || rule.pattern.length > HIGHLIGHT_LIMITS.maxPatternLength) return { matches: [] }
  if (!rule.isRegex) return { matches: matchLiteralRule(text, rule.pattern) }
  const regex = compileHighlightRegex(rule.pattern)
  if (!regex) return { matches: [] }
  return { matches: matchRegexRule(text, regex) }
}

function hasEffect(style: HighlightRuleStyle | undefined): style is HighlightRuleStyle {
  return !!style
    && (style.textColor !== undefined
      || style.backgroundColor !== undefined
      || style.underline !== undefined
      || style.line !== undefined)
}

/**
 * The line effect of one style set. A stored `line` always wins; the legacy
 * phase-3 boolean keeps its original meaning — `true` is a solid line in the
 * text color, `false` an explicit "no line" that still blocks later rules.
 */
export function highlightLineOf(style: HighlightRuleStyle | undefined): HighlightLineEffect {
  if (!style) return undefined
  if (style.line) return style.line
  if (style.underline === true) return { style: 'solid' }
  if (style.underline === false) return null
  return undefined
}

function countCaptureGroups(pattern: string): number {
  let count = 0
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '\\') { i++; continue }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') { inClass = true; continue }
    if (char !== '(') continue
    if (pattern[i + 1] === '?') {
      // (?:…) and lookarounds do not capture; (?<name>…) does.
      if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') count++
      continue
    }
    count++
  }
  return count
}

/** Number of capture groups a regex rule exposes (0 for literal rules). */
export function ruleGroupCount(rule: Pick<HighlightRuleDef, 'pattern' | 'isRegex'>): number {
  if (!rule.isRegex || !rule.pattern) return 0
  try {
    new RegExp(rule.pattern, 'u')
  } catch {
    return 0
  }
  return Math.min(countCaptureGroups(rule.pattern), HIGHLIGHT_LIMITS.maxGroups)
}

/**
 * Match every enabled rule against one paragraph text and merge the results
 * into non-overlapping segments. Per-effect priority: rules earlier in the
 * list win conflicts for that effect; within one rule, group styles override
 * the whole-match style field-by-field; effects left unset by earlier rules
 * can still be contributed by later ones.
 */
export function computeHighlightSegments(text: string, rules: HighlightRuleDef[]): HighlightSegment[] {
  return mergeHighlightSpans(text, collectHighlightSpans(text, rules))
}

export function collectHighlightSpans(text: string, rules: HighlightRuleDef[], firstOrder = 0): HighlightSpan[] {
  if (!text || text.length > HIGHLIGHT_LIMITS.maxParagraphLength) return []
  const spans: HighlightSpan[] = []
  let totalMatches = 0
  for (let order = 0; order < rules.length && order < HIGHLIGHT_LIMITS.maxRules; order++) {
    const rule = rules[order]!
    if (!rule.enabled) continue
    const { matches } = matchRuleInParagraph(text, rule)
    for (const raw of matches) {
      if (totalMatches >= HIGHLIGHT_LIMITS.maxMatchesPerParagraph || spans.length >= HIGHLIGHT_LIMITS.maxSpansPerParagraph) break
      const match = normalizePatternMatch(text, raw)
      if (!match) continue
      totalMatches++
      if (hasEffect(rule.style)) spans.push({ start: match.start, end: match.end, order: firstOrder + order, groupIndex: null, style: rule.style })
      for (const group of rule.groups ?? []) {
        if (spans.length >= HIGHLIGHT_LIMITS.maxSpansPerParagraph) break
        if (group.index < 1 || group.index > HIGHLIGHT_LIMITS.maxGroups) continue
        if (!hasEffect(group.style)) continue
        const range = match.groups[group.index - 1]
        if (!range) continue
        spans.push({ start: range[0], end: range[1], order: firstOrder + order, groupIndex: group.index, style: group.style })
      }
    }
  }
  return spans
}

export function mergeHighlightSpans(text: string, spans: HighlightSpan[]): HighlightSegment[] {
  if (!spans.length) return []

  // Sweep the paragraph left to right with an active-span set: because span
  // boundaries cut the text into elementary intervals, every active span
  // fully covers the current interval, so per-rule resolution is a scan of
  // the (small) active set instead of every collected span.
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  const boundaries = new Set<number>([0, text.length])
  for (const span of spans) { boundaries.add(span.start); boundaries.add(span.end) }
  const points = [...boundaries].sort((a, b) => a - b)
  let active: HighlightSpan[] = []
  let nextSpan = 0

  const segments: HighlightSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    if (end <= start) continue
    while (nextSpan < spans.length && spans[nextSpan]!.start <= start) active.push(spans[nextSpan++]!)
    if (active.length) active = active.filter((span) => span.end > start)
    if (!active.length) continue
    const style: HighlightSegment = { start, end }
    let textRank = Infinity
    let backgroundRank = Infinity
    let lineRank = Infinity
    for (const span of active) {
      const rank = span.order * (HIGHLIGHT_LIMITS.maxGroups + 1) + (span.groupIndex ?? HIGHLIGHT_LIMITS.maxGroups + 1)
      if (rank < textRank && span.style.textColor !== undefined) {
        textRank = rank
        style.textColor = span.style.textColor
      }
      if (rank < backgroundRank && span.style.backgroundColor !== undefined) {
        backgroundRank = rank
        style.backgroundColor = span.style.backgroundColor
      }
      const line = highlightLineOf(span.style)
      if (rank < lineRank && line !== undefined) {
        lineRank = rank
        if (line) style.line = line
        else delete style.line
      }
    }
    if (style.textColor !== undefined || style.backgroundColor !== undefined || style.line !== undefined) segments.push(style)
  }

  // Merge adjacent segments with identical styling.
  return mergeAdjacentSegments(segments)
}

function sameLine(left: HighlightRuleLine | undefined, right: HighlightRuleLine | undefined): boolean {
  if (!left || !right) return left === right
  return left.style === right.style && left.color === right.color
}

function mergeAdjacentSegments(segments: HighlightSegment[]): HighlightSegment[] {
  const merged: HighlightSegment[] = []
  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (previous && previous.end === segment.start
      && previous.textColor === segment.textColor
      && previous.backgroundColor === segment.backgroundColor
      && sameLine(previous.line, segment.line)) {
      previous.end = segment.end
      continue
    }
    merged.push({ ...segment })
  }
  return merged
}

/**
 * Manual-overlap yield: split segments so the automatic effects a manual
 * annotation covers stop drawing inside its interval, while the rest of the
 * match (and its other effects) keeps painting. A manual line mark suppresses
 * only the automatic line; a marker suppresses only the automatic background.
 */
export function applyManualYield(segments: HighlightSegment[], yields: ManualYieldInterval[]): HighlightSegment[] {
  if (!segments.length || !yields.length) return segments
  const sorted = [...yields].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: HighlightSegment[] = []
  for (const segment of segments) {
    let pieces: HighlightSegment[] = [segment]
    for (const interval of sorted) {
      if (interval.end <= segment.start) continue
      if (interval.start >= segment.end) break
      const next: HighlightSegment[] = []
      for (const piece of pieces) {
        const start = Math.max(piece.start, interval.start)
        const end = Math.min(piece.end, interval.end)
        if (end <= start) {
          next.push(piece)
          continue
        }
        if (start > piece.start) next.push({ ...piece, end: start })
        const covered: HighlightSegment = { ...piece, start, end }
        if (interval.line) delete covered.line
        if (interval.background) delete covered.backgroundColor
        if (covered.textColor !== undefined || covered.backgroundColor !== undefined || covered.line !== undefined) next.push(covered)
        if (end < piece.end) next.push({ ...piece, start: end })
      }
      pieces = next
    }
    out.push(...pieces)
  }
  return mergeAdjacentSegments(out.sort((a, b) => a.start - b.start || a.end - b.end))
}

/** One interval of a paragraph covered by a manual annotation. */
export interface ManualYieldInterval {
  start: number
  end: number
  /** The annotation draws a line under the text (underline/wavy/note ink) */
  line: boolean
  /** The annotation fills the background (marker highlight) */
  background: boolean
}
