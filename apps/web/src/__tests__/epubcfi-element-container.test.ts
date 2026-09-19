import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { fromRange, parse, toRange } from '../../public/foliate-js/epubcfi.js'

// Regression: a range boundary whose container is an ELEMENT (what
// setStartBefore/setEndAfter produce) used to attach the child index as an
// offset on an even element step, which partToString drops — the CFI then
// resolved to the parent's start (chapter top), corrupting bookmarks whose
// viewport edge sat exactly on a paragraph boundary.

const htmlDoc = (bodyHTML: string) =>
  new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><title>t</title></head><body>${bodyHTML}</body></html>`,
    'text/html',
  )

describe('fromRange with element-container boundaries', () => {
  it('keeps the position of a range starting before an element child', () => {
    const doc = htmlDoc('<p>AAA</p><p>BBB</p>')
    const [, p2] = Array.from(doc.querySelectorAll('p'))
    const range = doc.createRange()
    range.setStartBefore(p2)
    range.setEnd(p2.firstChild, 1)

    const cfi = fromRange(range)
    const resolved = toRange(doc, parse(cfi))

    expect(resolved).not.toBeNull()
    expect(resolved.startContainer).toBe(p2.firstChild)
    expect(resolved.startOffset).toBe(0)
    // guard against the old lossy shape silently resolving to body start
    expect(resolved.startContainer).not.toBe(doc.body)
  })

  it('keeps the position of a range ending after an element child', () => {
    const doc = htmlDoc('<p>AAA</p><p>BBB</p>')
    const [, p2] = Array.from(doc.querySelectorAll('p'))
    const range = doc.createRange()
    range.setStart(p2.firstChild, 1)
    range.setEndAfter(p2)

    const cfi = fromRange(range)
    const resolved = toRange(doc, parse(cfi))

    expect(resolved).not.toBeNull()
    expect(resolved.endContainer).toBe(p2.firstChild)
    expect(resolved.endOffset).toBe(3)
  })

  it('encodes a boundary before an empty element as a plain element step', () => {
    const doc = htmlDoc('<p>AAA</p><p></p><p>BBB</p>')
    const [, emptyP] = Array.from(doc.querySelectorAll('p'))
    const range = doc.createRange()
    range.setStartBefore(emptyP)
    range.setEndAfter(emptyP)

    const cfi = fromRange(range)
    const resolved = toRange(doc, parse(cfi))

    expect(resolved).not.toBeNull()
    // must not collapse to the body/document start
    expect(resolved.startContainer).not.toBe(doc.body)
  })

  it('round-trips a text-container range unchanged (existing behavior)', () => {
    const doc = htmlDoc('<p>AAA</p><p>BBB</p>')
    const [p1] = Array.from(doc.querySelectorAll('p'))
    const range = doc.createRange()
    range.setStart(p1.firstChild, 1)
    range.setEnd(p1.firstChild, 2)

    const resolved = toRange(doc, parse(fromRange(range)))
    expect(resolved.startContainer).toBe(p1.firstChild)
    expect(resolved.startOffset).toBe(1)
    expect(resolved.endOffset).toBe(2)
  })
})
