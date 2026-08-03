import { describe, expect, it } from 'vitest'

import { convertChinese } from '../lib/chinese'

describe('convertChinese', () => {
  it('converts simplified to traditional', async () => {
    expect(await convertChinese('我喜欢读书', 'traditional')).toBe('我喜歡讀書')
  })

  it('converts traditional to simplified', async () => {
    expect(await convertChinese('我喜歡讀書', 'simplified')).toBe('我喜欢读书')
  })

  it('returns text unchanged when off', async () => {
    expect(await convertChinese('我喜欢读书', 'off')).toBe('我喜欢读书')
  })

  // The t2s converter uses generic traditional ('t'), so a book that is
  // already simplified passes through without Taiwan-variant artifacts.
  it('leaves already-simplified text untouched in simplified mode', async () => {
    expect(await convertChinese('这算什么……你还戳！', 'simplified')).toBe('这算什么……你还戳！')
  })

  it('round-trips through both directions', async () => {
    const original = '我喜欢读书和写字'
    const converted = await convertChinese(original, 'traditional')
    const back = await convertChinese(converted, 'simplified')
    expect(back).toBe(original)
  })

  // Conversion runs on the whole chapter HTML string (transformTarget hook),
  // not on individual text nodes.
  it('converts a full HTML chapter string while preserving markup', async () => {
    const html = '<html><body><h1>第一章</h1><p class="indent">我喜欢读书。</p></body></html>'
    expect(await convertChinese(html, 'traditional')).toBe(
      '<html><body><h1>第一章</h1><p class="indent">我喜歡讀書。</p></body></html>',
    )
  })

  it('converts text inside attributes too (accepted string-level trade-off)', async () => {
    const html = '<a title="读书">读</a>'
    expect(await convertChinese(html, 'traditional')).toBe('<a title="讀書">讀</a>')
  })

  it('returns the identical string when off, markup included', async () => {
    const html = '<p>我喜欢读书</p>'
    expect(await convertChinese(html, 'off')).toBe(html)
  })
})