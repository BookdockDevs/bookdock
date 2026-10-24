import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

describe('continuous scroll leading-view eviction', () => {
  let trim: (this: Record<string, unknown>) => void

  afterAll(() => vi.unstubAllGlobals())

  beforeAll(async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const { continuousScrollTrimBefore } = await import('../../public/foliate-js/paginator.js')
    const source = readFileSync(resolve('public/foliate-js/paginator.js'), 'utf8')
    const body = source.split('    #trimDistantViews() {')[1].split('    #canGoToIndex(')[0]
    // Execute the production eviction body with controlled geometry and native
    // anchoring; jsdom cannot lay out the real iframe scroll container.
    trim = new Function('continuousScrollTrimBefore',
      `return function () {${body.slice(0, body.lastIndexOf('}')).replaceAll('this.#', 'this.')}}`,
    )(continuousScrollTrimBefore)
  })

  it.each([false, true].flatMap(vertical => [false, true].map(nativeAnchoring => ({
    vertical, nativeAnchoring,
  }))))('keeps the same text after eviction: %j', ({ vertical, nativeAnchoring }) => {
    const views = new Map(Array.from({ length: 16 }, (_, index) => [index, {
      element: { getBoundingClientRect: () => ({ height: 900, width: 900 }) },
    }]))
    let position = 11900
    const state = {
      size: 500,
      scrolled: true,
      noContinuousScroll: false,
      primaryIndex: 13,
      vertical,
      sideProp: vertical ? 'width' : 'height',
      views,
      get sortedViews() { return [...views.entries()] },
      get renderedStart() { return position },
      get renderedEnd() { return position + 500 },
      get containerPosition() { return vertical ? -position : position },
      set containerPosition(value: number) { position = Math.abs(value) },
      lastScrollPosition: 11900,
      getViewOffset(index: number) { return [...views.keys()].indexOf(index) * 900 },
      destroyView(index: number) {
        views.delete(index)
        if (nativeAnchoring) position -= 900
      },
    }
    const originalTextOffset = position - 13 * 900
    trim.call(state)

    expect([...views.keys()]).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(position).toBe(5600)
    expect(position - state.getViewOffset(13)).toBe(originalTextOffset)
    expect(state.lastScrollPosition).toBe(position)
    trim.call(state)
    expect(position).toBe(5600)
  })
})
