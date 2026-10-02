import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { extractEpubTextBlocks, formatTxtBlocks } from './txt-layout'

describe('TXT layout', () => {
  it('joins presentation line breaks in headings and recovers title-only volume headings', () => {
    const doc = new DOMParser().parseFromString('<html><body><h1 style="display:none" title="第一卷"></h1><h2 class="head"><span class="num">第001章</span><br/> 求职美女</h2><p>正文第一行<br/>正文第二行</p></body></html>', 'application/xml')
    const text = formatTxtBlocks(extractEpubTextBlocks(doc))
    expect(text).toBe('第一卷\n\n\n第001章 求职美女\n\n正文第一行\n正文第二行\n')
  })

  it('omits cover-only labels while retaining substantive cover-page text and normal Cover headings', () => {
    const parse = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'application/xml')
    expect(extractEpubTextBlocks(parse('<h1>Cover</h1><img src="cover.jpg"/>'))).toEqual([])
    expect(extractEpubTextBlocks(parse('<section epub:type="cover" xmlns:epub="http://www.idpf.org/2007/ops"><h1>封面</h1></section>'))).toEqual([])
    expect(extractEpubTextBlocks(parse('<h1>Cover</h1>'), true)).toEqual([])
    expect(extractEpubTextBlocks(parse('<h1>Cover</h1>'))).toEqual([{ kind: 'heading', text: 'Cover' }])
    expect(formatTxtBlocks(extractEpubTextBlocks(parse('<h1>Cover</h1><p>Actual book content.</p><img src="cover.jpg"/>'), true))).toContain('Actual book content.')
  })

  it('formats prose by its language without changing punctuation or private-use characters', () => {
    expect(formatTxtBlocks([
      { kind: 'heading', text: '标题' },
      { kind: 'paragraph', text: '　　中文“正文”\uE123。' },
      { kind: 'paragraph', text: '另一段正文。' },
      { kind: 'paragraph', text: 'English prose.' },
      { kind: 'paragraph', text: 'Another paragraph.' },
    ])).toBe('标题\n\n　　中文“正文”\uE123。\n　　另一段正文。\n\nEnglish prose.\n\nAnother paragraph.\n')
  })

  it('keeps headings, nested inline text, poems, lists, notes, captions and scene separators', () => {
    const doc = new DOMParser().parseFromString(`<html xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Ignore</title></head><body>
      <div><h1>标题</h1><p>中<span>文</span>正文 &amp; 内容</p>
      <p>诗歌第一行<br/>诗歌第二行</p><ul><li>条目一</li><li>条目二</li></ul>
      <ol start="3"><li>Third</li><li value="7">Seventh</li><li>Eighth</li></ol>
      <hr/><aside epub:type="footnote"><p>注释文字</p></aside><figure><img src="image.jpg"/><figcaption>图注文字</figcaption></figure>
      <pre>  code line\n    indented line</pre></div></body></html>`, 'application/xml')
    const text = formatTxtBlocks(extractEpubTextBlocks(doc))
    expect(text).toContain('标题\n\n　　中文正文 & 内容')
    expect(text).toContain('诗歌第一行\n诗歌第二行')
    expect(text).toContain('- 条目一\n- 条目二')
    expect(text).toContain('3. Third\n7. Seventh\n8. Eighth')
    expect(text).toContain('***')
    expect(text).toContain('注释文字')
    expect(text).toContain('图注文字')
    expect(text).toContain('  code line\n    indented line')
    expect(text).not.toContain('Ignore')
  })
})
