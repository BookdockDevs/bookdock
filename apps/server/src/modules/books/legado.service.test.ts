import { describe, expect, it } from 'vitest'

import type { BookReplacementRule } from './replacement-rules'
import { projectEpubChapterMarkup, projectTxtChapterContent } from './legado.service'

function rule(partial: Partial<BookReplacementRule>): BookReplacementRule {
  return {
    id: partial.id ?? 'rule-1',
    matchType: partial.matchType ?? 'pattern',
    pattern: partial.pattern ?? null,
    replacement: partial.replacement ?? null,
    isRegex: partial.isRegex ?? false,
    applyTo: partial.applyTo ?? 'content',
    effectiveEnabled: partial.effectiveEnabled ?? true,
    spineHref: partial.spineHref ?? null,
    textOffset: partial.textOffset ?? null,
    originalText: partial.originalText ?? null,
  }
}

describe('Legado chapter replacement projection', () => {
  const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Hidden title</title></head><body><h1>Chapter One</h1><p>Hello <em>world</em>.</p><p>Second paragraph.</p></body></html>`

  it('applies content and title pattern rules to EPUB markup', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({ id: 'content', pattern: 'world', replacement: 'Bookdock', applyTo: 'content' }),
      rule({ id: 'title', pattern: 'One', replacement: '1', applyTo: 'title' }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('<usehtml>')
    expect(content).toContain('<h1>Chapter 1</h1>')
    expect(content).toContain('<p>Hello <em>Bookdock</em>.</p>')
    expect(content).toContain('<p>Second paragraph.</p>')
  })

  it('applies an enabled point patch against the matching section href', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0001.xhtml',
        originalText: 'world',
        textOffset: 20,
      }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('Hello <em>reader</em>.')
  })

  it('does not apply a point patch to a different section', () => {
    const content = projectEpubChapterMarkup(markup, [
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0002.xhtml',
        originalText: 'world',
        textOffset: 20,
      }),
    ], 'OEBPS/chapter-0001.xhtml')

    expect(content).toContain('Hello <em>world</em>.')
  })

  it('preserves full-width indentation before inline EPUB elements', () => {
    const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>　　<span style="color:#008080">“我怎么没正行了，我正经着呢。”</span></p><img src="../Images/cover.jpg"/></body></html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/chapter.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
    )

    expect(content).toContain('<p>　　<font color="#008080">')
  })

  it('removes only a leading EPUB heading duplicated by Legado', () => {
    const duplicateHeadingMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>\n<h2>第一章<br/>故人来访</h2><p>正文第一段。</p><h2>正文中的小标题</h2><p>正文第二段。</p></body></html>`
    const content = projectEpubChapterMarkup(
      duplicateHeadingMarkup,
      [],
      'OEBPS/Text/chapter.xhtml',
      undefined,
      [],
      '第一章 故人来访',
    )

    expect(content).not.toContain('<h2>第一章')
    expect(content).toContain('正文第一段。')
    expect(content).toContain('正文中的小标题')
    expect(content).toContain('正文第二段。')
  })

  it('removes a duplicated EPUB heading after a decorative leading block', () => {
    const markup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><div class="logo"><img src="../Images/logo.png"/></div><h2 class="head"><span>第一章</span><br/>庄周梦蝶？</h2><p>正文第一段。</p></body></html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/Chapter002.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [],
      '第一章 庄周梦蝶？',
    )

    expect(content).toContain('<usehtml>')
    expect(content).toContain('path=OEBPS%2FImages%2Flogo.png')
    expect(content).toContain('正文第一段。')
    expect(content).not.toContain('庄周梦蝶？')
  })

  it('projects basic inline EPUB styles without carrying CSS declarations', () => {
    const styledMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p><span class="dialogue" style="color:#008080;font-weight:bold;font-style:italic;text-decoration:underline line-through">彩色文字</span></p></body></html>`
    const content = projectEpubChapterMarkup(styledMarkup, [], 'OEBPS/Text/chapter.xhtml')

    expect(content).toContain('<usehtml>')
    expect(content).toContain('<font color="#008080"><b><i><u><s>彩色文字</s></u></i></b></font>')
    expect(content).not.toContain('style=')
    expect(content).not.toContain('class=')
  })

  it('keeps EPUB images and projects media clicks to the Legado player', () => {
    const mediaMarkup = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p><img alt="Cover" src="../Images/cover.jpg"/><video poster="../Images/poster.jpg"><source src="../Video/demo.mp4" type="video/mp4"/></video></body></html>`
    const content = projectEpubChapterMarkup(
      mediaMarkup,
      [],
      'OEBPS/Text/chapter.xhtml',
      (path) => `https://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [{ type: 'audio', path: 'OEBPS/Audio/chapter.mp3' }],
    )

    expect(content).toContain('<usehtml>')
    expect(content).toContain('path=OEBPS%2FImages%2Fcover.jpg')
    expect(content).toContain('path=OEBPS%2FImages%2Fposter.jpg')
    expect(content).toContain('path=OEBPS%2FVideo%2Fdemo.mp4')
    expect(content).toContain('path=OEBPS%2FAudio%2Fchapter.mp3')
    expect(content).toContain('java.openVideoPlayer')
    expect(content).toContain('true)')
    expect(content).not.toContain('false)')
    expect(content).toContain('data:image/svg+xml;base64,')
    expect(content).not.toContain('<a href=')
    expect(content).not.toContain('<video')
  })

  it('projects generated TXT chapter runs with the deterministic section href', () => {
    const projected = projectTxtChapterContent('Chapter One', 'Hello world.\n\nSecond paragraph.', [
      rule({ pattern: 'Chapter', replacement: 'Part', applyTo: 'title' }),
      rule({ pattern: 'world', replacement: 'Bookdock', applyTo: 'content' }),
      rule({
        matchType: 'point',
        replacement: 'reader',
        spineHref: 'OEBPS/chapter-0001.xhtml',
        originalText: 'Second',
        textOffset: 20,
      }),
    ], 0)

    expect(projected).toEqual({ title: 'Part One', content: 'Hello Bookdock.\n\nreader paragraph.' })
  })

  it('removes an exact repeated TXT heading while preserving a non-identical opening', () => {
    expect(projectTxtChapterContent('第370章 入邺都', '入邺都\n\n将家里安顿好之后', [], 0)).toEqual({
      title: '第370章 入邺都',
      content: '将家里安顿好之后',
    })
    expect(projectTxtChapterContent('第370章 入邺都', '第370章 入邺都\n\n将家里安顿好之后', [], 0)).toEqual({
      title: '第370章 入邺都',
      content: '将家里安顿好之后',
    })
    expect(projectTxtChapterContent('第370章 入邺都', '入邺都之后，许青和紫女告别', [], 0).content)
      .toBe('入邺都之后，许青和紫女告别')
  })

  it('strips images, audio, and video when includeMedia is disabled', () => {
    const markup = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>Chapter 1</h1>
    <p>Opening text.</p>
    <img src="../Images/illustration.jpg" alt="插图" />
    <video src="../Video/demo.mp4" poster="../Images/poster.jpg" />
    <p>Closing text.</p>
  </body>
</html>`
    const content = projectEpubChapterMarkup(
      markup,
      [],
      'OEBPS/Text/chapter-0001.xhtml',
      (path) => `http://bookdock.test/api/v1/legado/books/book-1/resource?path=${encodeURIComponent(path)}`,
      [{ type: 'audio', path: 'OEBPS/Audio/bgm.mp3' }],
      'Chapter 1',
      false,
    )

    expect(content).not.toContain('<img')
    expect(content).not.toContain('illustration.jpg')
    expect(content).not.toContain('demo.mp4')
    expect(content).not.toContain('bgm.mp3')
    expect(content).toContain('Opening text.')
    expect(content).toContain('Closing text.')
  })
})
