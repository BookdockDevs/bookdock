import DOMPurify from 'dompurify'
import { marked } from 'marked'

import type { ReviewBodyFormat } from '@bookdock/shared'

/**
 * Review body rendering (phase 1 subset: paragraphs, breaks, bold, italic,
 * quotes, ordered/unordered lists, links). Parsing is delegated to marked;
 * raw HTML is dropped at the token level and the result is allowlisted
 * through DOMPurify — never a hand-rolled regex parser. Single newlines
 * render as breaks so edit, preview and published output agree.
 */

marked.use({ breaks: true, gfm: true })

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'a', 'code', 'pre']
const ALLOWED_ATTR = ['href', 'title']
const SAFE_PROTOCOL = /^(https?:|mailto:)/i

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer noopener')
  }
})

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitize(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: SAFE_PROTOCOL,
  })
}

function renderPlainBody(body: string): string {
  const paragraphs = body.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (paragraphs.length === 0) return ''
  return sanitize(paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join(''))
}

export function renderReviewBody(body: string, format: ReviewBodyFormat): string {
  if (format === 'plain') return renderPlainBody(body)
  // Drop raw-HTML tokens before parsing output: inline HTML in the source is
  // disabled, not rendered. walkTokens mutates a per-call copy, never globals.
  const dirty = marked.parse(body, {
    async: false,
    walkTokens(token) {
      if (token.type === 'html') token.type = 'text'
    },
  }) as string
  return sanitize(dirty)
}

type LexerToken = { type: string; text?: string; tokens?: LexerToken[]; items?: LexerToken[]; cells?: string[][]; header?: Array<{ text: string }> }

function collectTokenText(token: LexerToken, out: string[]): void {
  switch (token.type) {
    case 'text':
    case 'paragraph':
    case 'heading':
    case 'code':
    case 'blockquote':
      if (token.tokens?.length) {
        for (const child of token.tokens) collectTokenText(child, out)
      } else if (token.text) {
        out.push(token.text)
      }
      break
    case 'list':
      for (const item of token.items ?? []) collectTokenText(item, out)
      break
    case 'list_item':
      if (token.tokens?.length) {
        for (const child of token.tokens) collectTokenText(child, out)
      } else if (token.text) {
        out.push(token.text)
      }
      break
    case 'table':
      for (const cell of token.header ?? []) out.push(cell.text)
      for (const row of token.cells ?? []) for (const cell of row) out.push(cell)
      break
    case 'link':
    case 'em':
    case 'strong':
    case 'del':
    case 'codespan':
      if (token.tokens?.length) {
        for (const child of token.tokens) collectTokenText(child, out)
      } else if (token.text) {
        out.push(token.text)
      }
      break
    case 'escape':
      if (token.text) out.push(token.text)
      break
    default:
      if (token.tokens?.length) {
        for (const child of token.tokens) collectTokenText(child, out)
      } else if (token.text && token.type !== 'html') {
        out.push(token.text)
      }
      break
  }
}

/**
 * Readable list excerpt: plain text from the parsed token stream, never
 * regex-stripped markup. Inline code keeps its content; link targets are
 * dropped, link labels kept.
 */
export function reviewExcerpt(body: string, format: ReviewBodyFormat, maxLength = 140): string {
  let text: string
  if (format === 'plain') {
    text = body
  } else {
    const out: string[] = []
    for (const token of marked.lexer(body) as unknown as LexerToken[]) collectTokenText(token, out)
    text = out.join('\n')
  }
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, maxLength).trimEnd()}…`
}
