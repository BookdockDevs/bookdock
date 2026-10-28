import { describe, expect, it } from 'vitest'

import { filterEinkMedia, isEinkMedia } from '../eink/media-filter'
// @ts-expect-error Foliate is untyped JavaScript
import { fromRange, parse as parseCfi, toRange } from '../../public/foliate-js/epubcfi.js'

const xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p id="before">Before</p><img src="illustration.jpg" alt="Art"/><video id="movie" src="movie.mp4" poster="poster.jpg" controls="controls"><source src="movie.webm"/><track src="captions.vtt"/><p id="fallback">Video description <b>in text</b>.</p></video><audio src="sound.mp3" controls="controls">Audio description</audio><p id="after">After</p></body></html>`

function parse(markup: string) {
  return new DOMParser().parseFromString(markup, 'application/xhtml+xml')
}

describe('Kindle media filtering', () => {
  it('removes players and media sources while preserving illustrations, poster and fallback content', () => {
    const result = filterEinkMedia(xhtml, 'application/xhtml+xml')
    const doc = parse(result)
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('audio, video, source, track')).toBeNull()
    expect(doc.querySelector('img[alt="Art"]')?.getAttribute('src')).toBe('illustration.jpg')
    expect(doc.querySelector('img[src="poster.jpg"]')).not.toBeNull()
    expect(doc.querySelector('#fallback')?.textContent).toBe('Video description in text.')
    expect(doc.body.textContent).toContain('Audio description')
    expect(result).not.toContain('movie.mp4')
    expect(result).not.toContain('movie.webm')
    expect(result).not.toContain('sound.mp3')
  })

  it('preserves text position paths both inside and after the media element', () => {
    const before = parse(xhtml)
    const after = parse(filterEinkMedia(xhtml, 'application/xhtml+xml'))
    for (const selector of ['#fallback b', '#after']) {
      const text = before.querySelector(selector)!.firstChild!
      const range = before.createRange()
      range.setStart(text, 2)
      range.collapse(true)
      const restored = toRange(after, parseCfi(fromRange(range)))
      expect(restored.startContainer.textContent).toBe(text.textContent)
      expect(restored.startOffset).toBe(2)
    }
  })

  it('handles HTML fallback and embedded media without filtering ordinary objects or images', () => {
    const markup = '<html><body><video src="a.mp4">fallback</video><object type="audio/mpeg" data="a.mp3">transcript</object><object type="image/svg+xml" data="art.svg"></object><img src="a.png"></body></html>'
    const result = filterEinkMedia(markup, 'text/html')
    const doc = new DOMParser().parseFromString(result, 'text/html')
    expect(doc.querySelector('video, object[type="audio/mpeg"]')).toBeNull()
    expect(doc.body.textContent).toContain('fallbacktranscript')
    expect(doc.querySelector('object[data="art.svg"]')).not.toBeNull()
    expect(doc.querySelector('img[src="a.png"]')).not.toBeNull()
  })

  it('leaves normal chapters and non-chapter resources untouched and recognizes media requests', () => {
    const ordinary = '<html><body><img src="a.png"/><p>Text</p></body></html>'
    expect(filterEinkMedia(ordinary, 'application/xhtml+xml')).toBe(ordinary)
    expect(filterEinkMedia(xhtml, 'application/oebps-package+xml')).toBe(xhtml)
    expect(isEinkMedia('video/mp4', 'movie')).toBe(true)
    expect(isEinkMedia('application/octet-stream', 'music.MP3')).toBe(true)
    expect(isEinkMedia('image/webp', 'picture.webp')).toBe(false)
  })
})
