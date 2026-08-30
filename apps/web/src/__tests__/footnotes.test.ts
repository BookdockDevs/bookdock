import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { classifyFootnoteReference } from '../../public/foliate-js/footnotes.js'

describe('vendored footnote reference classification', () => {
  it('recognizes EPUB and ARIA noteref references', () => {
    const epubReference = document.createElement('a')
    epubReference.href = '#note-1'
    epubReference.setAttribute('epub:type', 'noteref')
    expect(classifyFootnoteReference(epubReference).kind).toBe('explicit')

    const ariaReference = document.createElement('a')
    ariaReference.href = '#note-2'
    ariaReference.setAttribute('role', 'doc-noteref')
    expect(classifyFootnoteReference(ariaReference).kind).toBe('explicit')
  })

  it('only treats a superscript as a footnote when its target is note-like', () => {
    const reference = document.createElement('a')
    reference.href = '#note-1'
    reference.style.verticalAlign = 'super'
    const target = document.createElement('aside')
    target.setAttribute('epub:type', 'footnote')
    target.textContent = '正文脚注'
    document.body.append(reference, target)

    expect(classifyFootnoteReference(reference, target).kind).toBe('heuristic')
    expect(classifyFootnoteReference(reference, document.createElement('div')).kind).toBe('normal')
    reference.remove()
    target.remove()
  })

  it('does not mistake numeric index links or backlinks for footnotes', () => {
    const list = document.createElement('p')
    list.innerHTML = '<a href="#a">1</a> <a href="#b">2</a>'
    document.body.append(list)
    expect(classifyFootnoteReference(list.querySelector('a')!).kind).toBe('normal')

    const backlink = document.createElement('a')
    backlink.href = '#ref-1'
    backlink.setAttribute('role', 'doc-backlink')
    expect(classifyFootnoteReference(backlink).kind).toBe('normal')
    list.remove()
  })
})
