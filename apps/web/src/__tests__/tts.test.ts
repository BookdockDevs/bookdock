import { vi } from 'vitest'

import { TTS } from '../../public/foliate-js/tts.js'

describe('foliate TTS positioning', () => {
  it.each([0, 1])('starts from the selected sentence at offset %i and continues forward', (offset) => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>机器人检查齿轮，记录温度；随后关闭舱门，完成准备。飞船驶离港口，进入预定航线。导航系统开始工作。</p>'
    const textNode = doc.querySelector('p')!.firstChild!
    const start = textNode.textContent!.indexOf('飞船驶离') + offset
    const range = doc.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, start + 3)

    const tts = new TTS(doc, undefined, () => undefined, (range: Range) => range.toString())
    expect(tts.from(range, { highlight: false })).toBe('飞船驶离港口，进入预定航线。')
    expect(tts.currentDetail()?.cfi).toBe('飞船驶离港口，进入预定航线。')
    expect(tts.collectDetails(1).map((detail) => detail.text)).toEqual(['导航系统开始工作。'])
    expect(tts.next()).toBe('导航系统开始工作。')
  })

  it.each([true, false])('positions a selection across inline elements (collapsed: %s)', (collapsed) => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>机器人完成准备。<span>飞船驶离</span>港口，进入航线。导航系统开始工作。</p>'
    const range = doc.createRange()
    range.setStart(doc.querySelector('span')!.firstChild!, 0)
    if (!collapsed) range.setEnd(doc.querySelector('p')!.lastChild!, 4)

    const tts = new TTS(doc, undefined, () => undefined, () => '')
    expect(tts.from(range, { highlight: false })).toBe('飞船驶离港口，进入航线。')
  })

  it('starts from the sentence at the visible range start', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>“哈？”樱岛麻衣皱眉，语气冷淡下来，“那你跑到这地方来干什么？旅游？” “朗读？” 后面的内容。</p>'
    const textNode = doc.querySelector('p')?.firstChild
    if (!textNode) throw new Error('test paragraph did not render')

    const range = doc.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.indexOf('后面的') ?? textNode.textContent?.length ?? 0)

    const tts = new TTS(doc, undefined, () => undefined, () => '')
    const text = tts.from(range, { highlight: false })

    expect(text).toBe('“哈？”')
    expect(text).not.toContain('后面的内容')
  })

  it('collects lookahead without moving the current sentence', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>第一句。第二句。第三句。</p>'
    const tts = new TTS(doc, undefined, () => undefined, () => '')
    expect(tts.start({ highlight: false })).toBe('第一句。')

    expect(tts.collectDetails(2, { offset: 1 }).map((detail) => detail.text)).toEqual(['第二句。', '第三句。'])
    expect(tts.currentDetail()?.text).toBe('第一句。')
    expect(tts.next()).toBe('第二句。')
  })

  it('keeps hidden content and local footnote links out of legacy TTS', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>第一句。<span hidden>隐藏内容。</span><a href="#note">脚注内容。</a>第二句。</p>'
    const tts = new TTS(doc, undefined, () => undefined, () => '')

    expect(tts.start({ highlight: false })).toBe('第一句。')
    expect(tts.next()).toBe('第二句。')
  })

  it('highlights an arbitrary word range through the legacy TTS highlighter', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>上午，四城科技总部大楼。</p>'
    const highlight = vi.fn((range: Range | null, layer?: string) => `${layer ?? 'sentence'}:${range?.toString() ?? ''}`)
    const tts = new TTS(doc, undefined, highlight, () => '')
    const word = doc.createRange()
    const text = doc.querySelector('p')?.firstChild
    if (!text) throw new Error('test paragraph did not render')
    word.setStart(text, 3)
    word.setEnd(text, 6)

    expect(tts.highlightRange(word)).toBe('word:四城科')
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(highlight.mock.calls[0]?.[0].toString()).toBe('四城科')
    expect(highlight.mock.calls[0]?.[1]).toBe('word')

    tts.clearWordHighlight()
    expect(highlight).toHaveBeenLastCalledWith(null, 'word')
  })
})
