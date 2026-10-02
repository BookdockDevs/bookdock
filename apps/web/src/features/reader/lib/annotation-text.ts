const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TR', 'FIGCAPTION'])

// Walk the live DOM: cloned fragments lose inherited visibility and stylesheet
// rules, while Range.toString() loses paragraph boundaries.
export function extractAnnotationText(range: Range, maxLength = Infinity): string {
  const doc = range.startContainer.ownerDocument
  if (!doc) return ''
  let text = ''
  const visit = (node: Node, preformatted = false): void => {
    if (text.length >= maxLength || !range.intersectsNode(node)) return
    if (node.nodeType === 3) {
      const value = node.textContent ?? ''
      const start = node === range.startContainer ? range.startOffset : 0
      const end = node === range.endContainer ? range.endOffset : value.length
      const selected = value.slice(start, end)
      text += (preformatted ? selected : selected.replace(/[\t\r\n ]+/g, ' ')).slice(0, Math.max(0, maxLength - text.length))
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.matches('script, style, template, noscript, button, input, select, textarea, [hidden], [aria-hidden="true"], [data-bd-reader-ui]')) return
    const style = doc.defaultView?.getComputedStyle(element)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return
    const tag = element.localName.toUpperCase()
    if (tag === 'BR') {
      text += '\n'
      return
    }
    const block = BLOCK_TAGS.has(tag)
    if (block && text && !text.endsWith('\n\n')) text += '\n\n'
    for (const child of element.childNodes) visit(child, preformatted || tag === 'PRE')
    if (block && text && !text.endsWith('\n\n')) text += '\n\n'
  }
  // Starting at the body also checks visibility inherited from ancestors.
  visit(doc.body ?? doc.querySelector('body') ?? range.commonAncestorContainer)
  return text.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^[\r\n\t ]+|[\r\n\t ]+$/g, '')
}

export function bookmarkContext(range: Range, maxLength: number): string {
  const doc = range.startContainer.ownerDocument
  const body = doc?.body ?? doc?.querySelector('body')
  if (!doc || !body || maxLength <= 0) return ''
  const start = range.cloneRange()
  start.collapse(true)
  const element = start.startContainer.nodeType === 1
    ? start.startContainer as Element
    : start.startContainer.parentElement
  const paragraph = element?.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6')
  let prefix = ''
  if (paragraph) {
    const before = start.cloneRange()
    before.setStart(paragraph, 0)
    const chars = Array.from(extractAnnotationText(before))
    prefix = (chars.length > 60 ? '…' : '') + chars.slice(-60).join('')
    if (prefix && /[\t\r\n ]$/.test(before.toString())) prefix += ' '
  }
  const after = start.cloneRange()
  after.setEnd(body, body.childNodes.length)
  const text = prefix + extractAnnotationText(after, maxLength * 2 + 2)
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  const bounded = chars.slice(0, maxLength - 1).join('')
  // Prefer a nearby sentence/paragraph ending without discarding most context.
  const endings = [...bounded.matchAll(/[。！？.!?](?:[”’"'])?|\n\n/g)]
  const last = endings.at(-1)
  const end = last ? last.index + last[0].length : 0
  return (end >= bounded.length * 0.7 ? bounded.slice(0, end).trimEnd() : bounded) + '…'
}
