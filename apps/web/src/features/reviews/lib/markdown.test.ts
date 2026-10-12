import { describe, expect, it } from 'vitest'

import { reviewNeedsSourceEditor } from '@bookdock/shared'

import { renderReviewBody, reviewExcerpt, reviewExcerptLines, reviewPlainText, reviewTextLength } from './markdown'

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

  it('counts readable text length without penalizing or incrementing for uploaded images', () => {
    const imgUrl = '/api/v1/content-files/cfile_abcdefghijklmnopqrstu'
    expect(reviewTextLength(`![screenshot](${imgUrl})`, 'markdown')).toBe(0)
    expect(reviewPlainText(`![screenshot](${imgUrl})`, 'markdown')).toBe('')

    const textBefore = '这是一段书评文字'
    const textWithImage = `这是一段书评文字\n\n![screenshot](${imgUrl})\n\n`
    expect(reviewTextLength(textWithImage, 'markdown')).toBe(textBefore.length)
    expect(reviewPlainText(textWithImage, 'markdown')).toBe(textBefore)

    // Links only count anchor text, not the url
    expect(reviewTextLength('[链接文字](https://example.com)', 'markdown')).toBe(4)
    expect(reviewPlainText('[链接文字](https://example.com)', 'markdown')).toBe('链接文字')

    // Code blocks preserve code content
    expect(reviewTextLength('```js\nconst x = 1;\n```', 'markdown')).toBe('const x = 1;'.length)

    // Plain format counts raw length
    expect(reviewTextLength('raw text', 'plain')).toBe(8)
  })

  it('keeps paragraph boundaries and manual breaks instead of joining everything', () => {
    expect(reviewExcerptLines('第一段。\n\n第二段。', 'markdown')).toBe('第一段。\n\n第二段。')
    expect(reviewExcerptLines('a\nb', 'markdown')).toBe('a\nb')
    expect(reviewExcerptLines('- a\n- b', 'markdown')).toBe('a\nb')
    expect(reviewExcerptLines('a\n\n\n\nb', 'markdown')).toBe('a\n\nb')
    expect(reviewExcerptLines('  \n\n  a  \n\n', 'markdown')).toBe('a')
    expect(reviewExcerptLines('a\n\n\nb', 'plain')).toBe('a\n\nb')
    expect(reviewExcerptLines('# T\n正文', 'markdown')).toBe('T\n正文')
    expect(reviewExcerptLines('l1\nl2\nl3\nl4', 'markdown')).toBe('l1\nl2\nl3\nl4')
  })

  it('skips images, tables, code and html without placeholder labels', () => {
    const imgUrl = '/api/v1/content-files/cfile_abcdefghijklmnopqrstu'
    expect(reviewExcerptLines(`![screenshot](${imgUrl})`, 'markdown')).toBe('')
    expect(reviewExcerptLines('| a | b |\n|---|---|\n| 1 | 2 |', 'markdown')).toBe('')
    expect(reviewExcerptLines('```js\nconst x = 1;\n```', 'markdown')).toBe('')
    expect(reviewExcerptLines('<iframe src="https://example.com/x"></iframe>', 'markdown')).toBe('')
    expect(reviewExcerptLines('a <b>hi</b> b', 'markdown')).toBe('a hi b')
    const mixed = '文字\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\n尾巴'
    const excerpt = reviewExcerptLines(mixed, 'markdown')
    expect(excerpt).toContain('文字')
    expect(excerpt).toContain('尾巴')
    expect(excerpt).not.toContain('code')
  })

  it('caps the whole excerpt without appending its own ellipsis', () => {
    const long = 'x'.repeat(700)
    const capped = reviewExcerptLines(long, 'markdown')
    expect(capped.length).toBeLessThanOrEqual(600)
    expect(capped.endsWith('…')).toBe(false)
    const multi = `${'y'.repeat(595)}\n\n第二段文字`
    const cappedMulti = reviewExcerptLines(multi, 'markdown')
    expect(cappedMulti).toContain('\n\n')
    expect(cappedMulti.endsWith('…')).toBe(false)
  })
})

