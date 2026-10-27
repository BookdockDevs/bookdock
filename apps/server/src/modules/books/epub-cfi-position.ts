import { DOMParser, Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'

function isText(node: XmlNode): boolean {
  return node.nodeType === 3 || node.nodeType === 4
}

function isElement(node: XmlNode): node is XmlElement {
  return node.nodeType === 1
}

function isXmlNode(value: XmlNode | XmlNode[] | string | null | undefined): value is XmlNode {
  return Boolean(value) && !Array.isArray(value) && typeof value !== 'string'
}

function indexedChildren(node: XmlNode): Array<XmlNode | XmlNode[] | string | null> {
  const flattened: XmlNode[] = []
  const visit = (parent: XmlNode) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (!isText(child) && !isElement(child)) continue
      if (isElement(child) && child.hasAttribute('cfi-inert')) continue
      if (isElement(child) && child.hasAttribute('cfi-skip')) visit(child)
      else flattened.push(child)
    }
  }
  visit(node)

  const grouped: Array<XmlNode | XmlNode[] | string | null> = []
  for (const child of flattened) {
    const last = grouped.at(-1)
    if (!last) grouped.push(child)
    else if (isText(child)) {
      if (Array.isArray(last)) last.push(child)
      else if (isXmlNode(last) && isText(last)) grouped[grouped.length - 1] = [last, child]
      else grouped.push(child)
    } else if (isXmlNode(last) && isElement(last)) grouped.push(null, child)
    else grouped.push(child)
  }
  const first = grouped[0]
  const last = grouped.at(-1)
  if (isXmlNode(first) && isElement(first)) grouped.unshift('first')
  if (isXmlNode(last) && isElement(last)) grouped.push('last')
  grouped.unshift('before')
  grouped.push('after')
  return grouped
}

function parseCfiSteps(cfi: string): Array<{ index: number; offset?: number }> | null {
  const wrapped = cfi.match(/epubcfi\((.*)\)/i)?.[1]
  if (!wrapped || wrapped.includes(',')) return null
  const localPath = wrapped.slice(wrapped.lastIndexOf('!') + 1)
  const steps: Array<{ index: number; offset?: number }> = []
  const pattern = /\/(\d+)(?:\[[^\]]*\])?(?::(\d+))?/g
  for (const match of localPath.matchAll(pattern)) {
    steps.push({ index: Number(match[1]), ...(match[2] === undefined ? {} : { offset: Number(match[2]) }) })
  }
  return steps.length ? steps : null
}

function expandCfiRange(cfi: string): [string, string] | null {
  const wrapped = cfi.match(/epubcfi\((.*)\)/i)?.[1]
  const separator = wrapped?.indexOf('!') ?? -1
  if (!wrapped || separator < 0) return null
  const packagePath = wrapped.slice(0, separator + 1)
  const localPath = wrapped.slice(separator + 1)
  const parts = localPath.split(',')
  if (parts.length === 1) return [cfi, cfi]
  if (parts.length !== 3) return null
  return [
    `epubcfi(${packagePath}${parts[0]}${parts[1]})`,
    `epubcfi(${packagePath}${parts[0]}${parts[2]})`,
  ]
}

function cfiNodePath(parent: XmlNode, target: XmlNode, path: number[] = []): number[] | null {
  for (const [index, child] of indexedChildren(parent).entries()) {
    if (Array.isArray(child)) {
      if (child.includes(target)) return [...path, index]
      continue
    }
    if (!isXmlNode(child)) continue
    if (child === target) return [...path, index]
    if (isElement(child)) {
      const nested = cfiNodePath(child, target, [...path, index])
      if (nested) return nested
    }
  }
  return null
}

function cfiTextPath(body: XmlNode, targetOffset: number): Array<{ index: number; offset?: number }> | null {
  let textOffset = 0
  const visit = (parent: XmlNode, path: Array<{ index: number; offset?: number }>): Array<{ index: number; offset?: number }> | null => {
    for (const [index, child] of indexedChildren(parent).entries()) {
      if (Array.isArray(child) || isXmlNode(child) && isText(child)) {
        const textNodes = Array.isArray(child) ? child : [child]
        const length = textNodes.reduce((sum, node) => sum + (node.nodeValue ?? '').length, 0)
        if (targetOffset >= textOffset && targetOffset <= textOffset + length) {
          return [...path, { index, offset: targetOffset - textOffset }]
        }
        textOffset += length
      } else if (isXmlNode(child) && isElement(child)) {
        const nested = visit(child, [...path, { index }])
        if (nested) return nested
      }
    }
    return null
  }
  return visit(body, [])
}

function cfiPathText(path: Array<{ index: number; offset?: number }>): string {
  return path.map(({ index, offset }) => `/${index}${offset === undefined ? '' : `:${offset}`}`).join('')
}

function cfiTextSteps(markup: string, textOffset: number): Array<{ index: number; offset?: number }> | null {
  const document = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  const root = document.documentElement
  const body = document.getElementsByTagName('body')[0]
  if (!root || !body) return null
  const bodyPath = cfiNodePath(root, body)
  const textPath = cfiTextPath(body, textOffset)
  return bodyPath && textPath ? [...bodyPath.map((index) => ({ index })), ...textPath] : null
}

function findTextOffset(body: XmlNode, target: XmlNode, offset: number): number | null {
  let total = 0
  let found: number | null = null
  const visit = (node: XmlNode) => {
    if (found !== null) return
    if (isText(node)) {
      if (node === target) {
        if (offset < 0 || offset > (node.nodeValue ?? '').length) return
        found = total + offset
        return
      }
      total += (node.nodeValue ?? '').length
      return
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!isText(child) && !isElement(child)) continue
      if (isElement(child) && child.hasAttribute('cfi-inert')) continue
      if (isElement(child) && child.hasAttribute('cfi-skip')) visit(child)
      else visit(child)
    }
  }
  visit(body)
  return found
}

export function resolveEpubCfiTextOffset(markup: string, cfi: string): number | null {
  const steps = parseCfiSteps(cfi)
  if (!steps) return null
  const document = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  const root = document.documentElement
  const body = document.getElementsByTagName('body')[0]
  if (!root || !body) return null

  let current: XmlNode | XmlNode[] | string | null = root
  for (const step of steps) {
    if (!current || Array.isArray(current) || typeof current === 'string') return null
    current = indexedChildren(current)[step.index] ?? null
    if (Array.isArray(current)) {
      if (step.offset === undefined) return null
      let remaining = step.offset
      let selected: XmlNode | null = null
      let localOffset = 0
      for (const textNode of current) {
        const length = (textNode.nodeValue ?? '').length
        if (remaining <= length) {
          selected = textNode
          localOffset = remaining
          break
        }
        remaining -= length
      }
      if (!selected) return null
      current = selected
      if (step === steps.at(-1)) return findTextOffset(body, selected, localOffset)
    } else if (step === steps.at(-1) && isXmlNode(current) && isText(current) && step.offset !== undefined) {
      return findTextOffset(body, current, step.offset)
    }
  }
  return null
}

export function resolveEpubCfiTextRange(markup: string, cfi: string): { start: number; end: number } | null {
  const expanded = expandCfiRange(cfi)
  if (!expanded) return null
  const start = resolveEpubCfiTextOffset(markup, expanded[0])
  const end = resolveEpubCfiTextOffset(markup, expanded[1])
  if (start === null || end === null || end < start) return null
  return { start, end }
}

export function resolveEpubCfiTextStart(markup: string, cfi: string): number | null {
  const expanded = expandCfiRange(cfi)
  return expanded ? resolveEpubCfiTextOffset(markup, expanded[0]) : null
}

export function createEpubCfiTextOffset(markup: string, spineIndex: number, textOffset: number): string | null {
  if (!Number.isInteger(spineIndex) || spineIndex < 0 || !Number.isInteger(textOffset) || textOffset < 0) return null
  const steps = cfiTextSteps(markup, textOffset)
  return steps ? `epubcfi(/6/${(spineIndex + 1) * 2}!${cfiPathText(steps)})` : null
}

export function createEpubCfiTextRange(markup: string, spineIndex: number, start: number, end: number): string | null {
  if (end < start) return null
  if (start === end) return createEpubCfiTextOffset(markup, spineIndex, start)
  const startSteps = cfiTextSteps(markup, start)
  const endSteps = cfiTextSteps(markup, end)
  if (!startSteps || !endSteps) return null
  let commonLength = 0
  while (commonLength < Math.min(startSteps.length, endSteps.length)
    && startSteps[commonLength]!.index === endSteps[commonLength]!.index
    && startSteps[commonLength]!.offset === undefined
    && endSteps[commonLength]!.offset === undefined) commonLength += 1
  const base = cfiPathText(startSteps.slice(0, commonLength))
  const relativeStart = cfiPathText(startSteps.slice(commonLength))
  const relativeEnd = cfiPathText(endSteps.slice(commonLength))
  return `epubcfi(/6/${(spineIndex + 1) * 2}!${base},${relativeStart},${relativeEnd})`
}

export function cfiSpineIndex(cfi: string, fallback?: number | null): number | null {
  const packagePath = cfi.match(/epubcfi\(\/6\/(\d+)(?:\[[^\]]*\])?!/i)?.[1]
  const step = packagePath ? Number(packagePath) : NaN
  if (Number.isInteger(step) && step >= 2 && step % 2 === 0) return step / 2 - 1
  return typeof fallback === 'number' && Number.isInteger(fallback) && fallback >= 0 ? fallback : null
}
