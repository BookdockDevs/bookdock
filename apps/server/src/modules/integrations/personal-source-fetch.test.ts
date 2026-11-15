import { describe, expect, it } from 'vitest'

import { decodeResponseText } from './personal-source-fetch'

// '中文' in GBK, used to prove the host decodes declared charsets instead of
// assuming UTF-8 (the sandbox has no TextDecoder, so a source cannot fix this).
const GBK_ZHONGWEN = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])

describe('decodeResponseText', () => {
  it('keeps UTF-8 bodies as-is', () => {
    expect(decodeResponseText(Buffer.from('中文', 'utf8'), 'application/json; charset=utf-8')).toBe('中文')
  })

  it('decodes a charset declared in the response header', () => {
    expect(decodeResponseText(GBK_ZHONGWEN, 'text/html; charset=gbk')).toBe('中文')
    expect(decodeResponseText(GBK_ZHONGWEN, 'text/html; charset=gb2312')).toBe('中文')
  })

  it('decodes a charset declared only in the document head', () => {
    const html = Buffer.concat([
      Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=gbk"><p>'),
      GBK_ZHONGWEN,
      Buffer.from('</p>'),
    ])
    expect(decodeResponseText(html, 'text/html')).toBe('<meta http-equiv="Content-Type" content="text/html; charset=gbk"><p>中文</p>')
  })

  it('falls back to UTF-8 for an unknown label instead of failing', () => {
    expect(decodeResponseText(Buffer.from('中文', 'utf8'), 'text/html; charset=x-unknown-8bit')).toBe('中文')
  })

  it('strips a leading byte order mark', () => {
    expect(decodeResponseText(Buffer.from('\uFEFF{}', 'utf8'), 'application/json')).toBe('{}')
  })
})
