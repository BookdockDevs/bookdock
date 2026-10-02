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
    const beforeText = extractAnnotationText(before)
    const chars = Array.from(beforeText)
    if (chars.length <= 60) {
      prefix = beforeText
    } else {
      const windowStr = chars.slice(-60).join('')
      const sentenceBreaks = [...windowStr.matchAll(/[。！？.!?](?:[”’"'])?|\n+/g)]
      if (sentenceBreaks.length > 0) {
        const lastBreak = sentenceBreaks.at(-1)!
        const startIdx = lastBreak.index + lastBreak[0].length
        prefix = windowStr.slice(startIdx).trimStart()
      } else {
        prefix = '…' + windowStr
      }
    }
    if (prefix && /[\t\r\n ]$/.test(before.toString())) prefix += ' '
  }
  const after = start.cloneRange()
  after.setEnd(body, body.childNodes.length)
  const afterText = extractAnnotationText(after, maxLength * 2 + 2)

  let text = prefix
  if (prefix && afterText) {
    if (paragraph) {
      const restOfParagraph = start.cloneRange()
      restOfParagraph.setEnd(paragraph, paragraph.childNodes.length)
      const restText = extractAnnotationText(restOfParagraph)
      // If the current paragraph ends here and afterText starts a new paragraph
      if (!restText && !prefix.endsWith('\n\n')) {
        text = prefix.trimEnd() + '\n\n' + afterText.trimStart()
      } else {
        text = prefix + afterText
      }
    } else {
      text = prefix + afterText
    }
  } else {
    text = prefix || afterText
  }
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  const bounded = chars.slice(0, maxLength - 1).join('')
  // Prefer a nearby paragraph ending if it retains sufficient context (>= 60%),
  // otherwise fallback to a sentence ending (>= 70%).
  const paragraphBreaks = [...bounded.matchAll(/\n\n+/g)]
  const lastParagraphBreak = paragraphBreaks.at(-1)
  if (lastParagraphBreak && lastParagraphBreak.index >= bounded.length * 0.6) {
    return bounded.slice(0, lastParagraphBreak.index).trimEnd()
  }

  const endings = [...bounded.matchAll(/(?:[。！？.!?…]+|[—–-]{2,})(?:[”’"'])?/g)]
  const last = endings.at(-1)
  const end = last ? last.index + last[0].length : 0
  if (end >= bounded.length * 0.7) {
    return bounded.slice(0, end).trimEnd()
  }
  return bounded.trimEnd() + '…'
}

export function isCustomBookmarkTitle(
  annotation: { text?: string | null; contextText?: string | null; chapter?: string | null },
  defaultLabel?: string,
): boolean {
  const text = annotation.text?.trim()
  if (!text) return false
  if (text === '书签' || text === 'Bookmark' || (defaultLabel && text.toLowerCase() === defaultLabel.trim().toLowerCase())) {
    return false
  }
  if (annotation.chapter && text === annotation.chapter.trim()) {
    return false
  }
  if (!annotation.contextText) {
    return false
  }
  const firstLine = annotation.contextText.split(/\n/).map((l) => l.trim()).find(Boolean) || ''
  const normText = text.replace(/\s+/g, '')
  const normFirstLine = firstLine.replace(/\s+/g, '')
  const normContext = annotation.contextText.replace(/\s+/g, '')
  if (normText && (normFirstLine.startsWith(normText) || normContext.startsWith(normText))) {
    return false
  }
  return true
}
