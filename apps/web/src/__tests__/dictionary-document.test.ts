import { afterEach, describe, expect, it, vi } from 'vitest'

import { dictionaryDocument, dictionaryResourceUrl } from '../features/reader/lib/dictionary-document'

const theme = { bg: 'Canvas', fg: 'CanvasText', accent: 'LinkText' }
afterEach(() => vi.unstubAllGlobals())

describe('dictionary definition isolation', () => {
  it('removes scripts, event handlers, remote resources and unsafe navigation', async () => {
    const source = '<script>alert(1)</script><img src="https://tracker.test/a.png" onerror="alert(2)"><img src="//tracker.test/a.png"><iframe src="https://tracker.test"></iframe><form action="/api"><input></form><a href="javascript:alert(1)">unsafe</a><a href="https://tracker.test">external</a><p>Definition</p>'
    const result = await dictionaryDocument(source, 'dict-test', new AbortController().signal, theme)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('tracker.test')
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('<form')
    expect(result).toContain('Definition')
    expect(result).toContain("default-src 'none'")
  })
  it('projects local images, pronunciation and entry navigation without executing dictionary code', async () => {
    expect(dictionaryResourceUrl('dict-test', 'img/a.png')).toBe('/api/v1/dictionaries/dict-test/resource?key=img%2Fa.png')
    const result = await dictionaryDocument('<img src="img/a.png"><a href="entry://hello">Word</a><a href="sound://audio/hello.mp3">Play</a>', 'dict-test', new AbortController().signal, theme)
    const parsed = new DOMParser().parseFromString(result, 'text/html')
    expect(parsed.querySelector('img')?.getAttribute('src')).toBe('/api/v1/dictionaries/dict-test/resource?key=img%2Fa.png')
    expect(parsed.querySelector('a')?.getAttribute('data-dictionary-entry')).toBe('hello')
    const soundAnchor = parsed.querySelector('a[data-sound-src]')
    expect(soundAnchor?.getAttribute('data-sound-src')).toContain('key=audio%2Fhello.mp3')
    expect(soundAnchor?.textContent).toBe('Play')
    expect(soundAnchor?.getAttribute('role')).toBe('button')

    const emptyResult = await dictionaryDocument('<a href="sound://empty.mp3"></a>', 'dict-test', new AbortController().signal, theme)
    const emptyParsed = new DOMParser().parseFromString(emptyResult, 'text/html')
    expect(emptyParsed.querySelector('svg.dict-speaker-icon')).not.toBeNull()
  })
  it('loads bundled styles once and scopes their resources to the dictionary', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('p{background:url(../image.png)}@import "https://tracker.test/style.css";'))
    vi.stubGlobal('fetch', fetch)
    const result = await dictionaryDocument('<link rel="stylesheet" href="css/style.css"><p>Entry</p>', 'dict-test', new AbortController().signal, theme)
    expect(fetch).toHaveBeenCalledOnce()
    expect(result).toContain('/api/v1/dictionaries/dict-test/resource?key=image.png')
    expect(result).not.toContain('tracker.test')
    expect(result).not.toContain('key=api')
    expect(dictionaryResourceUrl('dict-test', 'file:///etc/passwd')).toBeNull()
  })
})
