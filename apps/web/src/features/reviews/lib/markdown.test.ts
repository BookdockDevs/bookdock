import { describe, expect, it } from 'vitest'

import { reviewNeedsSourceEditor } from '@bookdock/shared'

import { renderReviewBody, reviewExcerpt } from './markdown'

describe('review markdown', () => {
  it('decodes entities in Markdown excerpts while preserving plain text semantics', () => {
    expect(reviewExcerpt('A &amp; B &#x4e66;', 'markdown')).toBe('A & B 书')
    expect(reviewExcerpt('A &amp; B', 'plain')).toBe('A &amp; B')
  })
  it('keeps unsafe embeds in source mode without treating examples in code as active content', () => {
    expect(reviewNeedsSourceEditor('<iframe src="x"></iframe>')).toBe(true)
    expect(reviewNeedsSourceEditor('[click](javascript:alert(1))')).toBe(true)
    expect(reviewNeedsSourceEditor('![external](https://example.com/image.png)')).toBe(true)
    expect(reviewNeedsSourceEditor('```html\n<iframe src="x"></iframe>\n```')).toBe(false)
    expect(reviewNeedsSourceEditor('[link](https://example.com)')).toBe(false)
  })
  it('renders the phase-1 subset with single-newline breaks', () => {
    const html = renderReviewBody('**bold** and *italic*\nsecond line\n\n> quote\n\n- a\n- b\n\n1. one\n2. two\n\n[text](https://example.com)', 'markdown')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<br>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('target="_blank"')
  })

  it('disables raw HTML and neutralizes dangerous links', () => {
    const html = renderReviewBody('hello <script>alert(1)</script> <img src=x onerror=alert(1)> <b>kept-text</b>\n\n[x](javascript:alert(1)) [y](data:text/html,hi)', 'markdown')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    // Raw HTML survives only as inert escaped text, never as elements.
    expect(html).toContain('&lt;img')
    expect(html).toContain('kept-text')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text/html')
  })

  it('renders plain bodies without interpreting markdown', () => {
    const html = renderReviewBody('**not bold** <b>escaped</b>\nline two\n\npara two', 'plain')
    expect(html).toContain('&lt;b&gt;escaped&lt;/b&gt;')
    expect(html).toContain('**not bold**')
    expect(html).not.toContain('<strong>')
    expect(html).toContain('<br>')
    expect(html).toContain('<p>')
  })

  it('derives excerpts from the token stream without markup scars', () => {
    expect(reviewExcerpt('**bold** and `code` with [label](https://example.com/page)', 'markdown', 140)).toBe(
      'bold and code with label',
    )
    expect(reviewExcerpt('# Title\n\n> quoted **text**\n\n- item one\n- item two', 'markdown', 140)).toContain('Title')
    expect(reviewExcerpt('**not bold** plain', 'plain', 140)).toBe('**not bold** plain')
  })

  it('truncates long content with an ellipsis and keeps newlines consistent', () => {
    const long = `${'word '.repeat(60)}\nnext line`
    const excerpt = reviewExcerpt(long, 'markdown', 20)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(21)
    const html = renderReviewBody('line one\nline two', 'markdown')
    expect(html).toContain('line one<br>line two')
  })

  it('renders headings, tables, code and managed images without accepting arbitrary embeds', () => {
    const url = '/api/v1/content-files/cfile_abcdefghijklmnopqrstu'
    const html = renderReviewBody(`# Heading\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n\`\`\`ts\nconst value = 1\n\`\`\`\n\n![photo](${url})\n\n[Attachment](${url})\n\n![remote](https://example.com/tracker.png)`, 'markdown')
    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<pre><code>')
    expect(html).toContain(`src="${url}"`)
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('download=""')
    expect(html).not.toContain('https://example.com/tracker.png')
    expect(reviewExcerpt('# Heading\n\n```ts\nlarge secret code\n```\n\n**Hello**!', 'markdown')).toBe('Heading Hello!')
  })
})
