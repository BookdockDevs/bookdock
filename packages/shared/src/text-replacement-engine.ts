/**
 * Shared text-replacement primitives. The renderer and TXT exporter both
 * operate on ordered text runs so a match may cross inline markup without
 * changing the surrounding element structure.
 */

export type ReplacementApplyTo = 'content' | 'title' | 'both'

export interface ReplacementRuleLike {
  id: string
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  applyTo?: ReplacementApplyTo
}

export interface TextRun {
  text: string
}

export interface ReplacementEdit {
  start: number
  end: number
  replacement: string
}

interface NormalizedRegex {
  pattern: string
  flags: string
}

function normalizeLegadoShorthands(pattern: string): { pattern: string; needsUnicode: boolean } {
  let normalized = ''
  let inClass = false
  let needsUnicode = false
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '\\' && index + 1 < pattern.length) {
      const next = pattern[index + 1]!
      if (next === 'w' && !inClass) {
        normalized += '[\\p{L}\\p{N}_\\u4e00-\\u9fff]'
        needsUnicode = true
        index++
        continue
      }
      if (next === 'w' && inClass) {
        normalized += '\\p{L}\\p{N}_\\u4e00-\\u9fff'
        needsUnicode = true
        index++
        continue
      }
      if (next === 'W' && !inClass) {
        normalized += '[^\\p{L}\\p{N}_\\u4e00-\\u9fff]'
        needsUnicode = true
        index++
        continue
      }
    }
    normalized += char
    if (char === '[' && pattern[index - 1] !== '\\') inClass = true
    if (char === ']' && pattern[index - 1] !== '\\') inClass = false
  }
  return { pattern: normalized, needsUnicode }
}

function normalizeRegex(pattern: string): NormalizedRegex {
  const prefix = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?\)/.exec(pattern)
  if (!prefix) {
    const shorthand = normalizeLegadoShorthands(pattern)
    return { pattern: shorthand.pattern, flags: shorthand.needsUnicode || /\\[pP]\{/.test(pattern) ? 'gu' : 'g' }
  }

  const enabled = new Set(prefix[1]!.split(''))
  const disabled = new Set(prefix[2]?.split('') ?? [])
  const unsupported = [...enabled, ...disabled].filter((flag) => !'imsuU'.includes(flag))
  if (unsupported.length > 0) throw new Error(`Unsupported inline regex flags: ${unsupported.join('')}`)

  const shorthand = normalizeLegadoShorthands(pattern.slice(prefix[0].length))
  const flags = new Set(['g'])
  if (enabled.has('i') && !disabled.has('i')) flags.add('i')
  if (enabled.has('m') && !disabled.has('m')) flags.add('m')
  if (enabled.has('s') && !disabled.has('s')) flags.add('s')
  if ((enabled.has('u') && !disabled.has('u')) || (enabled.has('U') && !disabled.has('U')) || shorthand.needsUnicode || /\\[pP]\{/.test(pattern)) flags.add('u')
  return { pattern: shorthand.pattern, flags: [...flags].join('') }
}

/** Compile the supported leading Legado/JVM inline flags to JavaScript flags. */
export function compileReplacementRegex(pattern: string): RegExp {
  const normalized = normalizeRegex(pattern)
  return new RegExp(normalized.pattern, normalized.flags)
}

function expandReplacement(
  replacement: string,
  match: RegExpExecArray,
  input: string,
): string {
  return replacement.replace(/\\([$\\])|\$(\$|&|`|'|\d{1,2}|<[^>]+>|\{[^}]+\})/g, (token, escaped: string | undefined, reference: string | undefined) => {
    if (escaped) return escaped
    if (!reference) return token
    if (reference === '$') return '$'
    if (reference === '&' || reference === '0') return match[0]
    if (reference === '`') return input.slice(0, match.index)
    if (reference === "'") return input.slice(match.index + match[0].length)
    if (reference.startsWith('<') || reference.startsWith('{')) return match.groups?.[reference.slice(1, -1)] ?? ''
    const group = Number(reference)
    return group < match.length ? (match[group] ?? '') : token
  })
}

/** Return non-overlapping edits using Legado-compatible global replacement semantics. */
export function getReplacementEdits(text: string, rule: ReplacementRuleLike): ReplacementEdit[] {
  const pattern = rule.pattern ?? ''
  if (!pattern) return []
  const replacement = rule.replacement ?? ''

  if (!rule.isRegex) {
    const edits: ReplacementEdit[] = []
    let from = 0
    while (from <= text.length - pattern.length) {
      const start = text.indexOf(pattern, from)
      if (start < 0) break
      edits.push({ start, end: start + pattern.length, replacement })
      from = start + pattern.length
    }
    return edits
  }

  const regex = compileReplacementRegex(pattern)
  const edits: ReplacementEdit[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) {
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: expandReplacement(replacement, match, text),
    })
    if (match[0].length === 0) regex.lastIndex++
  }
  return edits
}

function runStarts(runs: TextRun[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const run of runs) {
    starts.push(offset)
    offset += run.text.length
  }
  return starts
}

function locateOffset(
  runs: TextRun[],
  starts: number[],
  offset: number,
  side: 'start' | 'end',
): { runIndex: number; local: number } {
  for (let i = 0; i < runs.length; i++) {
    const start = starts[i]!
    const end = start + runs[i]!.text.length
    if (side === 'start' ? offset < end : offset <= end) {
      return { runIndex: i, local: offset - start }
    }
  }
  const last = runs.length - 1
  return { runIndex: last, local: runs[last]!.text.length }
}

function applyEdit(runs: TextRun[], starts: number[], edit: ReplacementEdit): void {
  const start = locateOffset(runs, starts, edit.start, 'start')
  const end = locateOffset(runs, starts, edit.end, 'end')
  if (start.runIndex === end.runIndex) {
    const run = runs[start.runIndex]!
    run.text = run.text.slice(0, start.local) + edit.replacement + run.text.slice(end.local)
    return
  }

  const first = runs[start.runIndex]!
  first.text = first.text.slice(0, start.local) + edit.replacement
  for (let i = start.runIndex + 1; i < end.runIndex; i++) runs[i]!.text = ''
  runs[end.runIndex]!.text = runs[end.runIndex]!.text.slice(end.local)
}

/** Apply a rule to a logical text stream represented by ordered DOM text runs. */
export function applyRuleToRuns(runs: TextRun[], rule: ReplacementRuleLike): void {
  if (runs.length === 0) return
  const edits = getReplacementEdits(runs.map((run) => run.text).join(''), rule)
  const starts = runStarts(runs)
  for (let i = edits.length - 1; i >= 0; i--) applyEdit(runs, starts, edits[i]!)
}

/** Apply one rule to a plain string. */
export function applyRuleToText(text: string, rule: ReplacementRuleLike): string {
  const edits = getReplacementEdits(text, rule)
  let result = text
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]!
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

export function applyTitleReplacements(text: string, rules: ReplacementRuleLike[]): string {
  let result = text
  for (const rule of rules) {
    if (rule.applyTo === 'content') continue
    try {
      result = applyRuleToText(result, rule)
    } catch {
      // A single invalid rule must not hide a title or block the reader.
    }
  }
  return result
}

export interface PointMatch {
  runIndex: number
  local: number
  endRunIndex: number
  endLocal: number
}

export function findPointMatch(
  runs: TextRun[],
  snapshot: string,
  textOffset: number,
): PointMatch | null {
  if (!snapshot || textOffset == null || runs.length === 0) return null
  const text = runs.map((run) => run.text).join('')
  let best: { start: number; dist: number } | null = null
  let from = 0
  while (from <= text.length - snapshot.length) {
    const at = text.indexOf(snapshot, from)
    if (at < 0) break
    const dist = Math.abs(at - textOffset)
    if (!best || dist < best.dist) best = { start: at, dist }
    from = at + 1
  }
  if (!best) return null

  const starts = runStarts(runs)
  const start = locateOffset(runs, starts, best.start, 'start')
  const end = locateOffset(runs, starts, best.start + snapshot.length, 'end')
  return { ...start, endRunIndex: end.runIndex, endLocal: end.local }
}

export function applyPointMatch(runs: TextRun[], match: PointMatch, replacement: string): void {
  if (match.runIndex === match.endRunIndex) {
    const run = runs[match.runIndex]!
    run.text = run.text.slice(0, match.local) + replacement + run.text.slice(match.endLocal)
    return
  }

  const first = runs[match.runIndex]!
  first.text = first.text.slice(0, match.local) + replacement
  for (let i = match.runIndex + 1; i < match.endRunIndex; i++) runs[i]!.text = ''
  runs[match.endRunIndex]!.text = runs[match.endRunIndex]!.text.slice(match.endLocal)
}

export function countRuleInText(text: string, rule: ReplacementRuleLike): number {
  try {
    return getReplacementEdits(text, rule).length
  } catch {
    return 0
  }
}
