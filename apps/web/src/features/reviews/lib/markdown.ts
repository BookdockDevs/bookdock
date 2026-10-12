import createDOMPurify from 'dompurify'
import { Marked } from 'marked'

import { contentFileIdFromUrl } from '@bookdock/shared'
import type { ReviewBodyFormat } from '@bookdock/shared'

export { reviewExcerpt, reviewExcerptLines, reviewPlainText, reviewTextLength } from '@bookdock/shared'

const parser = new Marked({ breaks: true, gfm: true })
const purifier = createDOMPurify(window)
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img']
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'align']
const SAFE_PROTOCOL = /^(https?:|mailto:|\/api\/v1\/content-files\/cfile_[A-Za-z0-9_-]{21}$)/i

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    if (contentFileIdFromUrl(node.getAttribute('href') ?? '')) node.setAttribute('download', '')
    else node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer noopener')
  } else if (node.tagName === 'IMG') {
    if (!contentFileIdFromUrl(node.getAttribute('src') ?? '')) node.removeAttribute('src')
    node.setAttribute('loading', 'lazy')
    node.setAttribute('decoding', 'async')
  }
})

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitize(dirty: string): string {
  return purifier.sanitize(dirty, {
    ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: SAFE_PROTOCOL,
  })
}

export function renderReviewBody(body: string, format: ReviewBodyFormat, unavailableImages: readonly string[] = [], unavailableLabel = 'Image unavailable'): string {
  if (format === 'plain') {
    const paragraphs = body.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    return sanitize(paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join(''))
  }
  const dirty = parser.parse(body, {
    async: false,
    walkTokens(token) {
      if (token.type === 'image' && unavailableImages.includes(token.href)) {
        token.type = 'text'
        token.text = escapeHtml(unavailableLabel)
        token.tokens = [{ type: 'text', raw: unavailableLabel, text: escapeHtml(unavailableLabel), escaped: true }]
        return
      }
      if (token.type === 'html' || (token.type === 'image' && !contentFileIdFromUrl(token.href))) token.type = 'text'
    },
  }) as string
  return sanitize(dirty)
}
