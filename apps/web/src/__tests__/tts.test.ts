import { TTS } from '../../public/foliate-js/tts.js'

describe('foliate TTS positioning', () => {
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
})
