import { parentPort } from 'node:worker_threads'

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { applyPointMatch, applyRuleToRuns, findPointMatch, type TextRun } from '@bookdock/shared'
import { Converter } from 'opencc-js'

export interface SearchInput {
  markup: string
  query: string
  mode: 'contains' | 'regex'
  matchCase: boolean
  conversion: 'off' | 'simplified' | 'traditional'
  replacements: Array<{
    id: string
    matchType: 'pattern' | 'point'
    pattern: string | null
    replacement: string | null
    isRegex: boolean
    applyTo: 'content' | 'title' | 'both'
    enabled: boolean
    effectiveEnabled?: boolean | null
    spineHref: string | null
    textOffset: number | null
    originalText: string | null
  }>
  spineHref: string
}

const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'])
const titles = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TITLE'])
const skipped = new Set(['HEAD', 'SCRIPT', 'STYLE', 'NOSCRIPT'])

function parseMarkup(markup: string): Document {
  let failed = false
  const doc = new DOMParser({ errorHandler: (level) => { if (level !== 'warning') failed = true } })
    .parseFromString(markup, 'application/xhtml+xml') as unknown as Document
  if (!failed) return doc
  return new DOMParser({ errorHandler: () => {} }).parseFromString(markup, 'text/html') as unknown as Document
}

function textNodes(doc: Document, excludeNoscript = true): Text[] {
  const nodes: Text[] = []
  const visit = (node: Node, excluded: boolean) => {
    const tag = node.nodeType === 1 ? (node as Element).tagName.toUpperCase() : ''
    const blocked = excluded || (node.nodeType === 1 && (skipped.has(tag) && (tag !== 'NOSCRIPT' || excludeNoscript)))
    if (node.nodeType === 3) {
      if (!blocked) nodes.push(node as Text)
      return
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, blocked)
  }
  visit(doc, false)
  return nodes
}

function titleElement(node: Text): Element | null {
  let element = node.parentElement
  while (element) {
    if (titles.has(element.tagName.toUpperCase())) return element
    element = element.parentElement
  }
  return null
}

function transform(markup: string, input: SearchInput): string {
  const doc = parseMarkup(markup)
  const nodes = textNodes(doc, false)
  const active = input.replacements.filter((rule) => (rule.effectiveEnabled ?? rule.enabled) && rule.matchType === 'pattern' && rule.pattern)
  const contentNodes = nodes.filter((node) => !titleElement(node))
  const contentRuns: TextRun[] = contentNodes.map((node) => ({ text: node.nodeValue ?? '' }))
  for (const rule of active.filter((item) => item.applyTo !== 'title')) {
    try { applyRuleToRuns(contentRuns, rule) } catch { /* Invalid per-book rules are ignored by the reader. */ }
  }
  for (const [index, node] of contentNodes.entries()) node.data = contentRuns[index]!.text

  const grouped = new Map<Element, Text[]>()
  for (const node of nodes) {
    const title = titleElement(node)
    if (title) grouped.set(title, [...(grouped.get(title) ?? []), node])
  }
  for (const group of grouped.values()) {
    const runs = group.map((node) => ({ text: node.nodeValue ?? '' }))
    for (const rule of active.filter((item) => item.applyTo !== 'content')) {
      try { applyRuleToRuns(runs, rule) } catch { /* Invalid per-book rules are ignored by the reader. */ }
    }
    for (const [index, node] of group.entries()) node.data = runs[index]!.text
  }

  const points = input.replacements.filter((rule) => (rule.effectiveEnabled ?? rule.enabled) && rule.matchType === 'point' && rule.spineHref === input.spineHref)
  if (points.length) {
    const runs = nodes.map((node) => ({ text: node.nodeValue ?? '' }))
    for (const rule of points) {
      if (!rule.originalText || rule.textOffset == null) continue
      const found = findPointMatch(runs, rule.originalText, rule.textOffset)
      if (found) applyPointMatch(runs, found, rule.replacement ?? '')
    }
    for (const [index, node] of nodes.entries()) node.data = runs[index]!.text
  }

  const transformed = new XMLSerializer().serializeToString(doc as unknown as import('@xmldom/xmldom').Document)
  if (input.conversion === 'off') return transformed
  const converter = input.conversion === 'simplified'
    ? Converter({ from: 't', to: 'cn' })
    : Converter({ from: 'cn', to: 'tw' })
  return converter(transformed)
}

function extract(markup: string): string {
  const doc = parseMarkup(markup)
  const nodes = textNodes(doc)
  let text = ''
  let previousBlock: Element | null = null
  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    let block = node.parentElement
    while (block && !blocks.has(block.localName.toLowerCase())) block = block.parentElement
    if (!value || (!block && /^[\t\n\r ]*$/.test(value))) continue
    if (text && block !== previousBlock) text += ' '
    text += value
    previousBlock = block
  }
  return text
}

function matches(text: string, input: SearchInput): Array<{ start: number; end: number }> {
  const output: Array<{ start: number; end: number }> = []
  if (!text || !input.query) return output
  if (input.mode === 'regex') {
    let regex: RegExp
    try { regex = new RegExp(input.query, input.matchCase ? 'gu' : 'giu') } catch { return output }
    for (const match of text.matchAll(regex)) {
      if (!match[0]) continue
      output.push({ start: match.index, end: match.index + match[0].length })
      if (output.length >= 2001) break
    }
    return output
  }
  const query = input.query.replace(/\s+/g, ' ').trim()
  if (!query) return output
  const haystack = input.matchCase ? text : text.toLowerCase()
  const needle = input.matchCase ? query : query.toLowerCase()
  let at = -1
  while ((at = haystack.indexOf(needle, at + 1)) >= 0) {
    output.push({ start: at, end: at + needle.length })
    if (output.length >= 2001) break
  }
  if (!output.length && /\s/.test(query)) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
    let regex: RegExp
    try { regex = new RegExp(escaped, input.matchCase ? 'gu' : 'giu') } catch { return output }
    for (const match of text.matchAll(regex)) {
      if (!match[0]) continue
      output.push({ start: match.index, end: match.index + match[0].length })
      if (output.length >= 2001) break
    }
  }
  return output
}

function excerpt(text: string, start: number, end: number) {
  const context = 50
  const before: string[] = []
  const after: string[] = []
  for (let index = start - 1; index >= 0 && before.length <= context; index--) {
    if (/\s/.test(text[index]!)) {
      while (index >= 0 && /\s/.test(text[index]!)) index--
      if (index < 0) break
      before.push(' ')
      index++
    } else before.push(text[index]!)
  }
  for (let index = end; index < text.length && after.length <= context; index++) {
    if (/\s/.test(text[index]!)) {
      while (index < text.length && /\s/.test(text[index]!)) index++
      if (index === text.length) break
      after.push(' ')
      index--
    } else after.push(text[index]!)
  }
  return {
    pre: `${before.length > context ? '…' : ''}${before.slice(0, context).reverse().join('')}`,
    match: `${text.slice(start, Math.min(end, start + 4000))}${end - start > 4000 ? '…' : ''}`,
    post: `${after.slice(0, context).join('')}${after.length > context ? '…' : ''}`,
  }
}

export function processReaderSearchChapter(input: SearchInput) {
  const text = extract(transform(input.markup, input))
  return { text, matches: matches(text, input).map((match) => ({ ...match, excerpt: excerpt(text, match.start, match.end) })) }
}

parentPort?.on('message', (input: SearchInput) => {
  try {
    parentPort?.postMessage(processReaderSearchChapter(input))
  } catch {
    parentPort?.postMessage({ error: 'regex-failed' })
  }
})
