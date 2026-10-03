import type { DOMParser } from '@xmldom/xmldom'

import { and, asc, eq, isNull, or } from 'drizzle-orm'

import { applyPointMatch, applyRuleToRuns, findPointMatch, type TextRun } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { textReplacementOverrides, textReplacements } from '../../db/schema'

export interface BookReplacementRule {
  id: string
  matchType: 'pattern' | 'point'
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  applyTo: 'content' | 'title' | 'both'
  effectiveEnabled: boolean
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
}

export async function loadEffectiveBookReplacementRules(userId: string, bookId: string): Promise<BookReplacementRule[]> {
  const db = getDb()
  const rows = await db.select().from(textReplacements).where(
    and(
      eq(textReplacements.userId, userId),
      or(
        and(eq(textReplacements.matchType, 'pattern'), isNull(textReplacements.bookId)),
        eq(textReplacements.bookId, bookId),
      ),
    ),
  ).orderBy(asc(textReplacements.sortOrder), asc(textReplacements.createdAt)).all()
  const overrides = await db.select().from(textReplacementOverrides).where(
    and(eq(textReplacementOverrides.userId, userId), eq(textReplacementOverrides.bookId, bookId)),
  ).all()
  const overrideByReplacement = new Map(overrides.map((override) => [override.replacementId, override]))

  return rows.map((row) => {
    const override = row.matchType === 'pattern' && row.bookId === null
      ? overrideByReplacement.get(row.id)
      : undefined
    return {
      id: row.id,
      matchType: row.matchType,
      pattern: row.pattern,
      replacement: row.replacement,
      isRegex: row.isRegex === 1,
      applyTo: row.applyTo as BookReplacementRule['applyTo'],
      effectiveEnabled: override ? override.enabled === 1 : row.enabled === 1,
      spineHref: row.spineHref,
      textOffset: row.textOffset,
      originalText: row.originalText,
    }
  })
}

export function applyChapterReplacements(runs: TextRun[], rules: BookReplacementRule[], spineHref: string): void {
  const patternRules = rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled && rule.pattern)
  const titleRuns = runs.slice(0, 1)
  const contentRuns = runs.slice(1)
  for (const rule of patternRules) {
    try {
      if (rule.applyTo !== 'content') applyRuleToRuns(titleRuns, rule)
      if (rule.applyTo !== 'title') applyRuleToRuns(contentRuns, rule)
    } catch {
      // One malformed rule must not make a chapter unavailable.
    }
  }

  for (const patch of rules) {
    if (patch.matchType !== 'point' || !patch.effectiveEnabled || patch.spineHref !== spineHref) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) continue
    const found = findPointMatch(runs, snapshot, patch.textOffset)
    if (!found) continue
    applyPointMatch(runs, found, patch.replacement ?? '')
  }
}

interface EpubNode {
  childNodes: ArrayLike<EpubNode>
  nodeName: string
  nodeType: number
  nodeValue: string | null
  parentNode: EpubNode | null
  tagName?: string
}

const SKIPPED_TAGS = new Set(['script', 'style', 'head'])
const TITLE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title'])

function nodeTag(node: EpubNode): string {
  return (node.tagName ?? node.nodeName ?? '').toLowerCase()
}

function isSkippedNode(node: EpubNode): boolean {
  let parent = node.parentNode
  while (parent) {
    if (SKIPPED_TAGS.has(nodeTag(parent))) return true
    parent = parent.parentNode
  }
  return false
}

function isTitleNode(node: EpubNode): boolean {
  let parent = node.parentNode
  while (parent) {
    if (TITLE_TAGS.has(nodeTag(parent))) return true
    parent = parent.parentNode
  }
  return false
}

function collectTextNodes(root: EpubNode): EpubNode[] {
  const nodes: EpubNode[] = []
  const visit = (node: EpubNode) => {
    if (node.nodeType === 3) {
      if (!isSkippedNode(node) && node.nodeValue) nodes.push(node)
      return
    }
    for (const child of Array.from(node.childNodes ?? [])) visit(child)
  }
  visit(root)
  return nodes
}

function applyPatternRules(runs: TextRun[], rules: BookReplacementRule[]): void {
  for (const rule of rules) {
    try {
      applyRuleToRuns(runs, rule)
    } catch {
      // One malformed rule must not make a chapter unavailable.
    }
  }
}

export function applyEpubChapterReplacements(doc: ReturnType<DOMParser['parseFromString']>, rules: BookReplacementRule[], href: string): void {
  const nodes = collectTextNodes(doc as unknown as EpubNode)
  const patternRules = rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled && rule.pattern)
  const contentNodes = nodes.filter((node) => !isTitleNode(node))
  const contentRuns = contentNodes.map((node) => ({ text: node.nodeValue ?? '' }))
  applyPatternRules(contentRuns, patternRules.filter((rule) => rule.applyTo !== 'title'))
  for (let index = 0; index < contentNodes.length; index += 1) {
    contentNodes[index]!.nodeValue = contentRuns[index]!.text
  }

  const titleGroups = new Map<EpubNode, EpubNode[]>()
  for (const node of nodes) {
    if (!isTitleNode(node)) continue
    let title = node.parentNode
    while (title && !TITLE_TAGS.has(nodeTag(title))) title = title.parentNode
    if (!title) continue
    const group = titleGroups.get(title) ?? []
    group.push(node)
    titleGroups.set(title, group)
  }
  for (const group of titleGroups.values()) {
    const runs = group.map((node) => ({ text: node.nodeValue ?? '' }))
    applyPatternRules(runs, patternRules.filter((rule) => rule.applyTo !== 'content'))
    for (let index = 0; index < group.length; index += 1) {
      group[index]!.nodeValue = runs[index]!.text
    }
  }

  const pointRuns = nodes.map((node) => ({ text: node.nodeValue ?? '' }))
  for (const patch of rules) {
    if (patch.matchType !== 'point' || !patch.effectiveEnabled || patch.spineHref !== href) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) continue
    const found = findPointMatch(pointRuns, snapshot, patch.textOffset)
    if (!found) continue
    applyPointMatch(pointRuns, found, patch.replacement ?? '')
  }
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.nodeValue = pointRuns[index]!.text
  }
}
