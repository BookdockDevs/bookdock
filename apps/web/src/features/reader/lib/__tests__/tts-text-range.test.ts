import { describe, expect, it } from 'vitest'

import { mapTtsBoundaryTexts, ttsBoundaryRange } from '../tts-text-range'

function selectedText(range: Range) {
  return range.toString()
}

describe('ttsBoundaryRange', () => {
  it('maps UTF-16 offsets through Chinese and repeated text nodes', () => {
    const doc = new DOMParser().parseFromString('<p>你好 <b>你好</b></p>', 'text/html')
    const base = doc.createRange()
    base.selectNodeContents(doc.querySelector('p')!)

    const word = ttsBoundaryRange(base, '你好 你好', 3, 2)

    expect(word && selectedText(word)).toBe('你好')
    expect(word?.startContainer.parentElement?.tagName).toBe('B')
  })

  it('maps text split across DOM nodes and rejects text altered by substitutions', () => {
    const doc = new DOMParser().parseFromString('<p>hel<b>lo</b>  world</p>', 'text/html')
    const base = doc.createRange()
    base.selectNodeContents(doc.querySelector('p')!)

    expect(ttsBoundaryRange(base, 'hello world', 0, 5)?.toString()).toBe('hello')
    expect(ttsBoundaryRange(base, 'hello changed', 0, 5)).toBeNull()
  })

  it('rejects out-of-bounds ranges', () => {
    const doc = new DOMParser().parseFromString('<p>word</p>', 'text/html')
    const base = doc.createRange()
    base.selectNodeContents(doc.querySelector('p')!)
    expect(ttsBoundaryRange(base, 'word', 0, 0)).toBeNull()
    expect(ttsBoundaryRange(base, 'word', 3, 2)).toBeNull()
  })

  it('handles a CFI range whose common ancestor is one text node', () => {
    const doc = new DOMParser().parseFromString('<p>single</p>', 'text/html')
    const text = doc.querySelector('p')!.firstChild!
    const base = doc.createRange()
    base.selectNodeContents(text)
    expect(ttsBoundaryRange(base, 'single', 0, 6)?.toString()).toBe('single')
  })
})

describe('mapTtsBoundaryTexts', () => {
  it('maps repeated boundary words in order and skips unmatched metadata text', () => {
    expect(mapTtsBoundaryTexts('go go now', [
      { offset: 0, duration: 1, text: 'go' },
      { offset: 1, duration: 1, text: 'missing' },
      { offset: 2, duration: 1, text: 'go' },
      { offset: 3, duration: 1, text: 'now' },
    ])).toEqual([
      { offsetSec: 0, durationSec: 0.0000001, text: 'go', start: 0, length: 2 },
      { offsetSec: 0.0000002, durationSec: 0.0000001, text: 'go', start: 3, length: 2 },
      { offsetSec: 0.0000003, durationSec: 0.0000001, text: 'now', start: 6, length: 3 },
    ])
  })
})
