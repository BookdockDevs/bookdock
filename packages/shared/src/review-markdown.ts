import { decodeHTML } from 'entities'
import { Marked } from 'marked'
import type { Token, Tokens } from 'marked'

import { contentFileIdFromUrl } from './content-file'
import type { ReviewBodyFormat } from './review'

const parser = new Marked({ gfm: true, breaks: true })

export function reviewNeedsSourceEditor(body: string): boolean {
  let unsafe = false
  parser.walkTokens(parser.lexer(body), (token) => {
    if (token.type === 'html') unsafe = true
    if (token.type === 'image' && !contentFileIdFromUrl((token as Tokens.Image).href)) unsafe = true
    if (token.type === 'link') {
      const href = (token as Tokens.Link).href
      if (!contentFileIdFromUrl(href) && !/^(https?:|mailto:)/i.test(href)) unsafe = true
    }
  })
  return unsafe
}

export function reviewFileReferences(body: string): { ids: string[]; imageIds: string[]; unmanagedImages: boolean } {
  const ids = new Set<string>()
  const imageIds = new Set<string>()
  let unmanagedImages = false
  parser.walkTokens(parser.lexer(body), (token) => {
    if (token.type !== 'image' && token.type !== 'link') return
    const id = contentFileIdFromUrl((token as Tokens.Image | Tokens.Link).href)
    if (id) {
      ids.add(id)
      if (token.type === 'image') imageIds.add(id)
    } else if (token.type === 'image') unmanagedImages = true
  })
  return { ids: [...ids], imageIds: [...imageIds], unmanagedImages }
}

function tokenText(token: Token): string {
  if (token.type === 'code' || token.type === 'image' || token.type === 'html' || token.type === 'def') return ''
  if (token.type === 'table') {
    const table = token as Tokens.Table
    return [...table.header, ...table.rows.flat()].map((cell) => cell.tokens.map(tokenText).join('')).join(' ')
  } else if (token.type === 'list') {
    return (token as Tokens.List).items.map((item) => item.tokens.map(tokenText).join('\n')).join('\n')
  } else if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens.map(tokenText).join(token.type === 'blockquote' ? '\n' : '')
  } else if ('text' in token && typeof token.text === 'string') return token.text
  return token.type === 'br' ? '\n' : ''
}

export function reviewExcerpt(body: string, format: ReviewBodyFormat, maxLength = 140): string {
  const text = (format === 'plain' ? body : decodeHTML(parser.lexer(body).map(tokenText).join('\n'))).replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
}

/**
 * Featured-preview excerpt: same token stream as reviewExcerpt, but line
 * structure survives — blocks join with single newlines, blank runs collapse
 * to a single empty line. Images, code, tables and html stay out without
 * placeholder labels. The cap only bounds DOM size and never appends an
 * ellipsis: visible truncation is the CSS line clamp's job so the dots land
 * at the end of the last visible line instead of on their own line.
 */
export function reviewExcerptLines(body: string, format: ReviewBodyFormat, maxLength = 600): string {
  const raw = format === 'plain'
    ? body
    : decodeHTML(parser.lexer(body).map((token) => (token.type === 'table' ? '' : tokenText(token))).join('\n'))
  const text = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd()
}

function extractCountableText(token: Token): string {
  if (token.type === 'image' || token.type === 'def') return ''
  if (token.type === 'html') {
    return token.text.replace(/<[^>]*>/g, '')
  }
  if (token.type === 'code') {
    return (token as Tokens.Code).text
  }
  if (token.type === 'table') {
    const table = token as Tokens.Table
    return [...table.header, ...table.rows.flat()].map((cell) => cell.tokens.map(extractCountableText).join('')).join(' ')
  }
  if (token.type === 'list') {
    return (token as Tokens.List).items.map((item) => item.tokens.map(extractCountableText).join('\n')).join('\n')
  }
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens.map(extractCountableText).join(token.type === 'blockquote' ? '\n' : '')
  }
  if ('text' in token && typeof token.text === 'string') {
    return token.text
  }
  if (token.type === 'br') return '\n'
  return ''
}

export function reviewPlainText(body: string, format: ReviewBodyFormat = 'markdown'): string {
  if (format === 'plain') return body
  if (!body) return ''
  return decodeHTML(parser.lexer(body).map(extractCountableText).filter((part) => part.length > 0).join('\n'))
}

export function reviewTextLength(body: string, format: ReviewBodyFormat = 'markdown'): number {
  if (format === 'plain') return body.length
  if (!body) return 0
  return reviewPlainText(body, format).length
}
