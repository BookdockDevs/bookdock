import { DOMParser, type Element } from '@xmldom/xmldom'

export interface TxtBlock {
  kind: 'heading' | 'paragraph' | 'structured' | 'separator'
  text: string
}

export function formatTxtBlocks(blocks: TxtBlock[]): string {
  let output = ''
  let previous: TxtBlock | undefined
  let previousChinese = false
  for (const block of blocks) {
    const text = block.kind === 'structured' ? block.text.replace(/\r\n?/g, '\n').trimEnd()
      : block.kind === 'heading' ? block.text.replace(/[\s\u3000]+/g, ' ').trim() : block.text.trim()
    if (!text.trim()) continue
    const chineseCount = (text.match(/\p{Script=Han}/gu) ?? []).length
    const latinCount = (text.match(/\p{Script=Latin}/gu) ?? []).length
    const chinese = chineseCount > 0 && chineseCount >= latinCount
    const ordinary = block.kind === 'paragraph' && !text.includes('\n')
    if (output) {
      output += block.kind === 'heading' ? '\n\n\n'
        : previous?.kind === 'heading' || block.kind !== 'paragraph' || previous?.kind !== 'paragraph'
          || !ordinary || !chinese || !previousChinese ? '\n\n' : '\n'
    }
    output += ordinary && chinese ? `　　${text}` : text
    previous = block
    previousChinese = ordinary && chinese
  }
  return output ? `${output}\n` : ''
}

/** Preserve block structure before whitespace normalization or text layout. */
export function extractEpubTextBlocks(doc: ReturnType<DOMParser['parseFromString']>, coverPage = false): TxtBlock[] {
  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement
  const blocks: TxtBlock[] = []
  const skipped = new Set(['head', 'script', 'style', 'audio', 'video', 'rt', 'rp'])
  const blockTags = new Set(['p', 'div', 'section', 'article', 'aside', 'figure', 'figcaption', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr'])
  const readInline = (node: Element, preserve = false): string => {
    let text = ''
    let listOrdinal = Number(node.getAttribute('start') ?? '1')
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const value = child.nodeValue ?? ''
        text += preserve ? value : /^\s*\n\s*$/.test(value) ? '' : value.replace(/[\t\r\n ]+/g, ' ')
      } else if (child.nodeType === 1) {
        const element = child as Element
        const tag = (element.localName ?? element.tagName).toLowerCase()
        if (skipped.has(tag)) continue
        if (tag === 'br') text += '\n'
        else {
          if (tag === 'li') {
            const parentTag = (node.localName ?? node.tagName).toLowerCase()
            const explicitValue = element.getAttribute('value')
            if (explicitValue !== null) listOrdinal = Number(explicitValue)
            if (!Number.isFinite(listOrdinal)) listOrdinal = 1
            text += parentTag === 'ol' ? `${listOrdinal++}. ` : '- '
          }
          text += readInline(element, preserve)
          if (blockTags.has(tag) && tag !== 'td' && tag !== 'th') text += '\n'
          if (tag === 'td' || tag === 'th') text += '\t'
        }
      }
    }
    return text
  }
  const visit = (element: Element) => {
    const tag = (element.localName ?? element.tagName).toLowerCase()
    if (skipped.has(tag)) return
    if (/^h[1-6]$/.test(tag)) {
      const title = readInline(element).replace(/[\s\u3000]+/g, ' ').trim() || element.getAttribute('title') || ''
      blocks.push({ kind: 'heading', text: title })
      return
    }
    if (tag === 'hr') {
      blocks.push({ kind: 'separator', text: '***' })
      return
    }
    if (tag === 'pre' || tag === 'blockquote' || tag === 'ul' || tag === 'ol' || tag === 'table') {
      blocks.push({ kind: 'structured', text: readInline(element, tag === 'pre') })
      return
    }
    if (tag === 'p' || tag === 'figcaption') {
      const text = readInline(element).trim()
      if (!text && element.getElementsByTagName('br').length > 0) {
        blocks.push({ kind: 'separator', text: '***' })
        return
      }
      blocks.push({ kind: text.includes('\n') ? 'structured' : /^[*＊※—─·•\s]+$/u.test(text) ? 'separator' : 'paragraph', text })
      return
    }
    let inline = ''
    const flush = () => {
      if (inline.trim()) blocks.push({ kind: inline.includes('\n') ? 'structured' : 'paragraph', text: inline.trim() })
      inline = ''
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) inline += (child.nodeValue ?? '').replace(/[\t\r\n ]+/g, ' ')
      else if (child.nodeType === 1) {
        const nested = child as Element
        const nestedTag = (nested.localName ?? nested.tagName).toLowerCase()
        if (skipped.has(nestedTag)) continue
        if (blockTags.has(nestedTag)) {
          flush()
          visit(nested)
        } else if (nestedTag === 'br') inline += '\n'
        else inline += readInline(nested)
      }
    }
    flush()
  }
  if (body) visit(body)
  if (body) {
    const coverType = (body.getAttribute('epub:type') ?? '').split(/\s+/).includes('cover')
      || body.getAttribute('role') === 'doc-cover'
      || Array.from(body.getElementsByTagName('*')).some((element) => (element.getAttribute('epub:type') ?? '').split(/\s+/).includes('cover') || element.getAttribute('role') === 'doc-cover')
    const hasImage = body.getElementsByTagName('img').length > 0 || body.getElementsByTagName('image').length > 0
    const text = blocks.map((block) => block.text.trim()).filter(Boolean).join(' ')
    if ((coverPage || coverType || hasImage) && /^(?:cover|封面)?$/i.test(text)) return []
  }
  return blocks
}
