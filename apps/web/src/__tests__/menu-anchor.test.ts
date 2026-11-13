import { beforeEach, describe, expect, it } from 'vitest'

import {
  collectClipAncestors,
  isAnchorReachable,
  pointerAnchor,
  resolveMenuAnchor,
} from '../lib/menu-anchor'

interface RectInput {
  left: number
  top: number
  width: number
  height: number
}

function makeElement(rect: RectInput, parent: HTMLElement = document.body) {
  const el = document.createElement('div')
  stubRect(el, rect)
  parent.appendChild(el)
  return el
}

function stubRect(el: Element, rect: RectInput) {
  el.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  }) as DOMRect
}

function stubClientBox(el: Element, box: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, 'clientLeft', { configurable: true, value: box.left })
  Object.defineProperty(el, 'clientTop', { configurable: true, value: box.top })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: box.width })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: box.height })
}

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

describe('pointerAnchor', () => {
  it('keeps the click offset inside the element so the menu can follow it', () => {
    const el = makeElement({ left: 100, top: 200, width: 300, height: 200 })

    const anchor = pointerAnchor(el, { x: 160, y: 260 })

    expect(anchor).toMatchObject({ kind: 'pointer', el, dx: 60, dy: 60 })
  })
})

describe('resolveMenuAnchor', () => {
  it('places a pointer menu at the captured offset', () => {
    const el = makeElement({ left: 100, top: 200, width: 300, height: 200 })

    const position = resolveMenuAnchor(pointerAnchor(el, { x: 160, y: 260 }), { width: 200, height: 120 })

    expect(position).toMatchObject({ left: 160, top: 260, dir: 'down' })
  })

  it('places an element menu to the side of its trigger', () => {
    const el = makeElement({ left: 100, top: 100, width: 200, height: 40 })

    const position = resolveMenuAnchor({ kind: 'element', el, placement: 'side' }, { width: 200, height: 100 })

    expect(position).toMatchObject({ left: 300, top: 148 })
  })

  it('opens a dropdown below the trigger when there is room', () => {
    const el = makeElement({ left: 100, top: 100, width: 200, height: 40 })

    const position = resolveMenuAnchor({ kind: 'element', el, placement: 'below' }, { width: 200, height: 100 })

    expect(position).toMatchObject({ left: 100, top: 146, dir: 'down' })
  })

  it('prefers opening upwards, and flips down only when nothing fits above', () => {
    const low = makeElement({ left: 100, top: 600, width: 60, height: 30 })
    const high = makeElement({ left: 100, top: 20, width: 60, height: 30 })

    expect(resolveMenuAnchor({ kind: 'element', el: low, placement: 'above' }, { width: 200, height: 200 }))
      .toMatchObject({ top: 394, dir: 'up' })
    expect(resolveMenuAnchor({ kind: 'element', el: high, placement: 'above' }, { width: 200, height: 300 }))
      .toMatchObject({ top: 56, dir: 'down' })
  })

  it('clamps the result into the viewport even when the anchor is wider than the space', () => {
    // Wide anchor: the side placement alone would put the menu at 1100, so its
    // right edge lands at 1300 - past the 1280 viewport.
    const el = makeElement({ left: 400, top: 100, width: 900, height: 40 })

    const position = resolveMenuAnchor({ kind: 'element', el, placement: 'side' }, { width: 200, height: 100 })

    expect(position?.left).toBe(1072)
  })

  it('aligns the menu to the end edge of its trigger', () => {
    const el = makeElement({ left: 900, top: 100, width: 200, height: 40 })

    const position = resolveMenuAnchor({ kind: 'element', el, placement: 'side', align: 'end' }, { width: 120, height: 100 })

    expect(position?.left).toBe(980)
  })

  it('returns null once the anchor is detached', () => {
    const el = makeElement({ left: 100, top: 100, width: 100, height: 40 })
    el.remove()

    expect(resolveMenuAnchor({ kind: 'element', el, placement: 'side' }, { width: 120, height: 100 })).toBeNull()
  })
})

describe('isAnchorReachable', () => {
  it('reports false when the anchor is scrolled out of its clipping container but still inside the viewport', () => {
    // The sidebar case: the row keeps a viewport rect, yet the scrolling nav has
    // already clipped it away. Only the viewport check would keep the menu open.
    const nav = document.createElement('div')
    nav.style.overflowY = 'hidden'
    stubRect(nav, { left: 0, top: 400, width: 300, height: 200 })
    stubClientBox(nav, { left: 0, top: 0, width: 300, height: 200 })
    document.body.appendChild(nav)

    const row = makeElement({ left: 20, top: 300, width: 240, height: 40 }, nav)

    expect(isAnchorReachable(row, collectClipAncestors(row))).toBe(false)
  })

  it('reports true while the anchor is inside the visible part of its container', () => {
    const nav = document.createElement('div')
    nav.style.overflowY = 'auto'
    stubRect(nav, { left: 0, top: 100, width: 300, height: 200 })
    stubClientBox(nav, { left: 0, top: 0, width: 300, height: 200 })
    document.body.appendChild(nav)

    const row = makeElement({ left: 20, top: 150, width: 240, height: 40 }, nav)

    expect(isAnchorReachable(row, collectClipAncestors(row))).toBe(true)
  })

  it('ignores an axis the container does not clip', () => {
    const strip = document.createElement('div')
    strip.style.overflowX = 'hidden'
    stubRect(strip, { left: 0, top: 0, width: 300, height: 100 })
    stubClientBox(strip, { left: 0, top: 0, width: 300, height: 100 })
    document.body.appendChild(strip)

    // Vertically outside the container, but the container only clips X.
    const row = makeElement({ left: 20, top: 200, width: 100, height: 40 }, strip)

    expect(isAnchorReachable(row, collectClipAncestors(row))).toBe(true)
  })

  it('reports false when the anchor leaves the viewport', () => {
    const el = makeElement({ left: 100, top: -200, width: 100, height: 40 })

    expect(isAnchorReachable(el, [])).toBe(false)
  })
})
