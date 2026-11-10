import { describe, expect, it } from 'vitest'
import { securePublicationMarkup } from './secure-publication-markup'

describe('untrusted EPUB markup', () => {
  it('blocks scripts, active documents, event handlers and refresh while retaining resources and CFI neighbors', () => {
    const output = securePublicationMarkup('<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=800,height=600"/><meta http-equiv="refresh" content="0;url=https://example.com"/><link rel="stylesheet" href="style.css"/></head><body><script>parent.compromised=true</script><p onclick="parent.compromised=true">Quote</p><iframe srcdoc="&lt;script&gt;bad()&lt;/script&gt;"/><img src="image.png" onerror="bad()"/><audio src="audio.wav" controls="controls"/><a href="javascript:bad()" epub:type="noteref" xmlns:epub="http://www.idpf.org/2007/ops">Note</a></body></html>', 'application/xhtml+xml')
    const doc = new DOMParser().parseFromString(output, 'application/xhtml+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('script,iframe,[onclick],[onerror],[srcdoc]')).toBeNull()
    expect(doc.querySelector('p')?.previousElementSibling?.localName).toBe('span')
    expect(doc.querySelector('meta[name=viewport]')?.getAttribute('content')).toBe('width=800,height=600')
    expect(doc.querySelector('link')?.getAttribute('href')).toBe('style.css')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('image.png')
    expect(doc.querySelector('audio')?.getAttribute('src')).toBe('audio.wav')
    expect(doc.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(doc.querySelector('a')?.getAttribute('epub:type')).toBe('noteref')
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'none'")
    expect(output).not.toContain('url=https://example.com')
  })

  it('sanitizes SVG active content without removing its image geometry', () => {
    const output = securePublicationMarkup('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" onload="bad()"><script>bad()</script><rect width="32" height="32" fill="red"/></svg>', 'image/svg+xml')
    expect(output).not.toMatch(/<script|onload/)
    expect(output).toContain('<rect')
    expect(output).toContain('width="32"')
  })

  it('preserves engine-owned Blob stylesheet and media URLs while rejecting executable protocols', () => {
    const output = securePublicationMarkup('<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="blob:http://localhost/style"/></head><body><audio src="blob:http://localhost/audio"/><a href="java&#x09;script:bad()">Unsafe</a></body></html>', 'application/xhtml+xml')
    const doc = new DOMParser().parseFromString(output, 'application/xhtml+xml')
    expect(doc.querySelector('link')?.getAttribute('href')).toBe('blob:http://localhost/style')
    expect(doc.querySelector('audio')?.getAttribute('src')).toBe('blob:http://localhost/audio')
    expect(doc.querySelector('a')?.getAttribute('href')).toBeNull()
  })
})
