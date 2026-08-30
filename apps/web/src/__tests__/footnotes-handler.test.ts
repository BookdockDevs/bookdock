import { beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { FootnoteHandler } from '../../public/foliate-js/footnotes.js'

interface MockBook {
  documents: Document[]
  resolveHref: (href: string) => Promise<{ index: number; anchor: (doc: Document) => Element | null }>
}

class MockFootnoteView extends HTMLElement {
  private book: MockBook | null = null

  open(book: MockBook) {
    this.book = book
    return Promise.resolve()
  }

  goTo(index: number) {
    queueMicrotask(() => {
      const doc = this.book?.documents[index]
      if (doc) this.dispatchEvent(new CustomEvent('load', { detail: { doc } }))
    })
    return Promise.resolve()
  }

  close() {}
}

beforeAll(() => {
  customElements.define('foliate-view', MockFootnoteView)
})

function bookFor(target: Element | null, index = 1): MockBook {
  const documents = Array.from({ length: index + 1 }, () => document.implementation.createHTMLDocument())
  const targetDocument = documents[index]
  if (target) targetDocument.body.append(target.cloneNode(true))
  return {
    documents,
    resolveHref: async () => ({
      index,
      anchor: (doc) => doc.body.firstElementChild,
    }),
  }
}

describe('vendored FootnoteHandler', () => {
  it('extracts a hidden aside into a temporary view for explicit noteref links', async () => {
    const target = document.createElement('aside')
    target.id = 'note-1'
    target.setAttribute('epub:type', 'footnote')
    target.setAttribute('hidden', '')
    target.textContent = '跨章节脚注内容'
    const book = bookFor(target)
    const anchor = document.createElement('a')
    anchor.href = '#note-1'
    anchor.setAttribute('role', 'doc-noteref')
    const event = new CustomEvent('link', { cancelable: true, detail: { a: anchor, href: 'chapter-2.xhtml#note-1' } })
    const handler = new FootnoteHandler()

    const result = await handler.handle(book, event)

    expect(event.defaultPrevented).toBe(true)
    expect(result.kind).toBe('open')
    expect(result.hidden).toBe(true)
    expect(result.type).toBe('footnote')
    expect(result.view).toBeInstanceOf(MockFootnoteView)
    expect(book.documents[1].body.textContent).toContain('跨章节脚注内容')
    expect(result.target.hasAttribute('hidden')).toBe(false)
    handler.dispose(result.view)
    expect(result.view.isConnected).toBe(false)
  })

  it('resolves a same-chapter footnote through the same temporary-view path', async () => {
    const target = document.createElement('p')
    target.textContent = '同章脚注内容'
    const book = bookFor(target, 0)
    const anchor = document.createElement('a')
    anchor.href = '#note-1'
    anchor.setAttribute('epub:type', 'noteref')
    const event = new CustomEvent('link', { cancelable: true, detail: { a: anchor, href: '#note-1' } })

    const result = await new FootnoteHandler().handle(book, event)

    expect(result.kind).toBe('open')
    expect(book.documents[0].body.textContent).toBe('同章脚注内容')
  })

  it('returns fallback when an explicit reference cannot be extracted', async () => {
    const book = bookFor(null)
    book.resolveHref = async () => ({
      index: 1,
      anchor: () => null,
    })
    const anchor = document.createElement('a')
    anchor.href = '#missing'
    anchor.setAttribute('epub:type', 'noteref')
    const event = new CustomEvent('link', { cancelable: true, detail: { a: anchor, href: '#missing' } })
    const result = await new FootnoteHandler().handle(book, event)

    expect(result).toEqual({ kind: 'fallback', href: '#missing' })
  })

  it('cancels a request before the target view is created', async () => {
    let resolveTarget!: (target: { index: number; anchor: (doc: Document) => Element | null }) => void
    const book = bookFor(null)
    book.resolveHref = () => new Promise((resolve) => { resolveTarget = resolve })
    const anchor = document.createElement('a')
    anchor.href = '#note-1'
    anchor.setAttribute('epub:type', 'noteref')
    const event = new CustomEvent('link', { cancelable: true, detail: { a: anchor, href: '#note-1' } })
    const handler = new FootnoteHandler()
    const request = handler.handle(book, event) as (Promise<{ kind: string }> & { requestId?: number })

    await Promise.resolve()
    handler.cancel(request.requestId!)
    resolveTarget({ index: 1, anchor: () => null })

    await expect(request).resolves.toMatchObject({ kind: 'cancelled' })
  })
})
