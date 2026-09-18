import { findCueIndexForTime, MediaOverlaySection, parseMediaOverlay, rangeForMediaOverlayCue } from '../media-overlay'

describe('media overlay adapter', () => {
  it('parses ordered SMIL cues and resolves paths relative to the SMIL file', () => {
    const cues = parseMediaOverlay(`
      <smil xmlns="http://www.w3.org/ns/SMIL">
        <body><seq>
          <par><text src="../Text/chapter.xhtml#one"/><audio src="../Audio/book.mp3" clipBegin="00:00:01.500" clipEnd="2.5"/></par>
          <par><text src="../Text/chapter.xhtml#two"/><audio src="../Audio/book.mp3" clip-begin="3s"/></par>
        </seq></body>
      </smil>`, 'OPS/Smil/chapter.smil')

    expect(cues).toEqual([
      {
        index: 0,
        textHref: 'OPS/Text/chapter.xhtml',
        textFragment: 'one',
        audioHref: 'OPS/Audio/book.mp3',
        clipBegin: 1.5,
        clipEnd: 2.5,
      },
      {
        index: 1,
        textHref: 'OPS/Text/chapter.xhtml',
        textFragment: 'two',
        audioHref: 'OPS/Audio/book.mp3',
        clipBegin: 3,
        clipEnd: null,
      },
    ])
  })

  it('maps a cue fragment to the target element range', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML = '<p id="one">第一句</p><p id="two">第二句</p>'
    const cue = parseMediaOverlay(
      '<smil><body><par><text src="chapter.xhtml#two"/><audio src="audio.mp3" clipEnd="4"/></par></body></smil>',
      'OPS/chapter.smil',
    )[0]!

    const range = rangeForMediaOverlayCue(cue, 'ops/CHAPTER.xhtml', doc)
    expect(range?.toString()).toBe('第二句')
  })

  it('loads SMIL once and exposes the section identity', async () => {
    const loadText = async () => '<smil><body><par><text src="chapter.xhtml#one"/><audio src="audio.mp3"/></par></body></smil>'
    const section = new MediaOverlaySection({
      sectionIndex: 2,
      sectionHref: 'chapter.xhtml',
      mediaOverlayHref: 'chapter.smil',
      loadText,
    })

    expect(section.sectionIndex).toBe(2)
    expect(section.sectionHref).toBe('chapter.xhtml')
    expect(await section.load()).toHaveLength(1)
    expect(await section.load()).toHaveLength(1)
  })

  it('accurately resolves cue index by playback time across gaps and boundaries', () => {
    const mockCues = [
      { index: 0, textHref: 'c1.xhtml', textFragment: 'p1', audioHref: 'a.mp3', clipBegin: 0, clipEnd: 4 },
      { index: 1, textHref: 'c1.xhtml', textFragment: 'p2', audioHref: 'a.mp3', clipBegin: 5, clipEnd: 9 },
      { index: 2, textHref: 'c1.xhtml', textFragment: 'p3', audioHref: 'a.mp3', clipBegin: 10, clipEnd: 15 },
    ]

    expect(findCueIndexForTime([], 5)).toBe(0)
    expect(findCueIndexForTime(mockCues, -2)).toBe(0)
    expect(findCueIndexForTime(mockCues, 0)).toBe(0)
    expect(findCueIndexForTime(mockCues, 2)).toBe(0)
    // In silence gap between cue 0 (end 4s) and cue 1 (begin 5s), resolves to cue 0 before cue 1 begins
    expect(findCueIndexForTime(mockCues, 4.5)).toBe(0)
    expect(findCueIndexForTime(mockCues, 5)).toBe(1)
    expect(findCueIndexForTime(mockCues, 7.2)).toBe(1)
    expect(findCueIndexForTime(mockCues, 9.8)).toBe(1)
    expect(findCueIndexForTime(mockCues, 10)).toBe(2)
    expect(findCueIndexForTime(mockCues, 12)).toBe(2)
    // Past last cue start/end
    expect(findCueIndexForTime(mockCues, 20)).toBe(2)
  })

  it('correctly resolves middle cues when seeking to mid-chapter and keeps next button accessible', () => {
    // 04:20 audio (260s) with 5 paragraphs
    const chapterCues = [
      { index: 0, textHref: 'c1.xhtml', textFragment: 'p1', audioHref: 'a.mp3', clipBegin: 0, clipEnd: 50 },
      { index: 1, textHref: 'c1.xhtml', textFragment: 'p2', audioHref: 'a.mp3', clipBegin: 50, clipEnd: 110 },
      { index: 2, textHref: 'c1.xhtml', textFragment: 'p3', audioHref: 'a.mp3', clipBegin: 110, clipEnd: 170 },
      { index: 3, textHref: 'c1.xhtml', textFragment: 'p4', audioHref: 'a.mp3', clipBegin: 170, clipEnd: 220 },
      { index: 4, textHref: 'c1.xhtml', textFragment: 'p5', audioHref: 'a.mp3', clipBegin: 220, clipEnd: 260 },
    ]

    // Seeking to 02:02 (122 seconds) should be in cue 2 (110s - 170s)
    const midIndex = findCueIndexForTime(chapterCues, 122)
    expect(midIndex).toBe(2)
    // Both previous (0 < 2) and next (2 < 4) must be enabled
    expect(midIndex > 0).toBe(true)
    expect(midIndex < chapterCues.length - 1).toBe(true)
  })

  it('handles SMIL files where clipBegin is omitted and only clipEnd is provided', () => {
    const sequentialCues = [
      { index: 0, textHref: 'c1.xhtml', textFragment: 'p1', audioHref: 'a.mp3', clipBegin: null, clipEnd: 60 },
      { index: 1, textHref: 'c1.xhtml', textFragment: 'p2', audioHref: 'a.mp3', clipBegin: null, clipEnd: 120 },
      { index: 2, textHref: 'c1.xhtml', textFragment: 'p3', audioHref: 'a.mp3', clipBegin: null, clipEnd: 180 },
      { index: 3, textHref: 'c1.xhtml', textFragment: 'p4', audioHref: 'a.mp3', clipBegin: null, clipEnd: 240 },
    ]

    expect(findCueIndexForTime(sequentialCues, 30)).toBe(0)
    expect(findCueIndexForTime(sequentialCues, 90)).toBe(1)
    expect(findCueIndexForTime(sequentialCues, 150)).toBe(2)
    expect(findCueIndexForTime(sequentialCues, 200)).toBe(3)
  })
})

