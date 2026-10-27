import type { EpubEditorDocument, EpubEditorTocEntry } from './epub-editor-draft'

export interface EpubTocNode {
  index: number
  entry: EpubEditorTocEntry
  children: EpubTocNode[]
}

export function splitTocHref(href: string): { documentHref: string; fragment: string | null } {
  const separator = href.indexOf('#')
  return separator < 0
    ? { documentHref: href, fragment: null }
    : { documentHref: href.slice(0, separator), fragment: href.slice(separator + 1) || null }
}

export function buildEpubTocTree(entries: EpubEditorTocEntry[]): EpubTocNode[] {
  const roots: EpubTocNode[] = []
  const stack: EpubTocNode[] = []
  entries.forEach((entry, index) => {
    const node = { index, entry, children: [] }
    while (stack.length > 0 && stack.at(-1)!.entry.level >= entry.level) stack.pop()
    if (stack.length > 0) stack.at(-1)!.children.push(node)
    else roots.push(node)
    stack.push(node)
  })
  return roots
}

export function visibleEpubTocNodes(nodes: EpubTocNode[], query: string): EpubTocNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return nodes
  return nodes.flatMap((node) => {
    const children = visibleEpubTocNodes(node.children, normalizedQuery)
    return node.entry.title.toLocaleLowerCase().includes(normalizedQuery) || children.length > 0
      ? [{ ...node, children }]
      : []
  })
}

function isHeading(element: Element): boolean {
  return /^h[1-6]$/i.test(element.localName) && element.childElementCount === 0
}

export function findSafeEpubHeading(
  document: EpubEditorDocument,
  entry: EpubEditorTocEntry,
): { headingIndex: number | null; reason: string | null } {
  const { documentHref, fragment } = splitTocHref(entry.href)
  if (documentHref !== document.href) return { headingIndex: null, reason: '先定位到对应正文文件后再同步标题。' }
  const parsed = new DOMParser().parseFromString(document.content, 'application/xhtml+xml')
  if (parsed.querySelector('parsererror')) return { headingIndex: null, reason: '正文 XHTML 结构无法安全识别。' }
  const body = parsed.getElementsByTagName('body')[0]
  if (!body) return { headingIndex: null, reason: '正文文件没有可识别的 body 节点。' }
  const headings = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  if (fragment) {
    const targets = [...body.querySelectorAll('[id]')].filter((element) => element.getAttribute('id') === decodeFragment(fragment))
    const target = targets[0]
    if (targets.length !== 1 || !target || !isHeading(target)) {
      return { headingIndex: null, reason: '片段没有唯一指向可安全编辑的纯文本标题节点。' }
    }
    return { headingIndex: headings.indexOf(target), reason: null }
  }
  const candidates = headings.filter((element) => isHeading(element) && element.textContent?.trim() === entry.title.trim())
  if (candidates.length !== 1) return { headingIndex: null, reason: '没有唯一且文字匹配的正文标题节点。' }
  return { headingIndex: headings.indexOf(candidates[0]!), reason: null }
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

export { extractEpubVisibleText as visibleEpubText } from './epub-document-adapter'
