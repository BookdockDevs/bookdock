import { describe, expect, it, vi } from 'vitest'

import { forwardTextPaths } from '../forward-text-paths'
import { attachTextPrefetch } from '../../renderers/FoliateReader'

describe('forwardTextPaths', () => {
  it('keeps spine order, skips non-linear items, and deduplicates raw files', () => {
    expect([...forwardTextPaths([
      { id: 'text/current.xhtml' },
      { id: 'text/appendix.xhtml', linear: 'no' },
      { id: 'text/next.xhtml' },
      { id: 'text/next.xhtml#section-2' },
      { id: 'text/later.xhtml' },
    ], 0)]).toEqual([
      'text/next.xhtml',
      'text/later.xhtml',
    ])
  })

  it('does not inspect later spine items after the consumer has enough candidates', () => {
    let laterRead = false
    const sections = [
      { id: 'current.xhtml' },
      { id: 'next.xhtml' },
      { get id() { laterRead = true; return 'later.xhtml' } },
    ]
    const candidates = forwardTextPaths(sections, 0)

    expect(candidates.next()).toEqual({ value: 'next.xhtml', done: false })
    expect(laterRead).toBe(false)
  })

  it('keeps the Range fallback to the immediate next spine file', () => {
    const loadText = vi.fn(async () => '<p>warm</p>')
    const book = {
      sections: [
        { id: 'text/current.xhtml' },
        { id: 'text/next.xhtml' },
        { id: 'text/outside-window.xhtml' },
        { id: 'text/last.xhtml' },
      ],
      textPrefetch: (_index: number) => {},
    }

    attachTextPrefetch(book, loadText)
    book.textPrefetch(0)

    expect(loadText).toHaveBeenCalledTimes(1)
    expect(loadText).toHaveBeenCalledWith('text/next.xhtml')
  })
})
