import { beforeAll, describe, expect, it, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('foliate paginator renderer contract', () => {
  let Paginator: typeof import('../../public/foliate-js/paginator.js').Paginator
  let getDocumentBackground: typeof import('../../public/foliate-js/paginator.js').getDocumentBackground
  let continuousScrollTrimBefore: typeof import('../../public/foliate-js/paginator.js').continuousScrollTrimBefore
  let snapWheelStep: typeof import('../../public/foliate-js/paginator.js').snapWheelStep
  let resolvePaginatedColumnCount: typeof import('../../public/foliate-js/paginator.js').resolvePaginatedColumnCount

  beforeAll(async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ;({ Paginator, getDocumentBackground, continuousScrollTrimBefore, snapWheelStep, resolvePaginatedColumnCount } = await import('../../public/foliate-js/paginator.js'))
  })

  it('supports preload and continuous-scroll controls', () => {
    expect(Paginator.observedAttributes).toEqual(expect.arrayContaining([
      'no-preload',
      'no-background',
      'no-continuous-scroll',
    ]))

    const renderer = document.createElement('foliate-paginator') as InstanceType<typeof Paginator>
    renderer.setAttribute('flow', 'scrolled')
    renderer.setAttribute('no-preload', '')
    renderer.setAttribute('no-background', '')
    renderer.setAttribute('no-continuous-scroll', '')

    expect(renderer.noPreload).toBe(true)
    expect(renderer.noBackground).toBe(true)
    expect(renderer.noContinuousScroll).toBe(true)
    expect(renderer.primaryIndex).toBe(-1)
  })

  it('keeps both reading flows on the full-width scroll surface', () => {
    const renderer = document.createElement('foliate-paginator') as InstanceType<typeof Paginator>
    const shadowText = renderer.shadowRoot?.textContent ?? ''

    expect(shadowText).toMatch(/#container\s*\{[\s\S]*grid-column:\s*1 \/ -1[\s\S]*grid-row:\s*2/)
    expect(shadowText).toMatch(/:host\(\[flow="scrolled"\]\) #container\s*\{[\s\S]*grid-column:\s*1 \/ -1[\s\S]*grid-row:\s*2/)
    expect(shadowText).toMatch(/#background\s*\{[\s\S]*grid-column:\s*1 \/ -1[\s\S]*grid-row:\s*2/)
    expect(shadowText).toMatch(/:is\(#header, #footer\)\s*\{[\s\S]*grid-column:\s*1 \/ -1/)
    expect(shadowText).toMatch(/#header\s*\{[\s\S]*grid-row:\s*1/)
    expect(shadowText).toMatch(/#footer\s*\{[\s\S]*grid-row:\s*3/)
    expect(shadowText).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1.8fr) minmax(0, 1fr);')
    expect(shadowText).toMatch(/grid-template-rows:\s*max\([\s\S]*minmax\(0, 1fr\)[\s\S]*max\(/)
    expect(shadowText).not.toContain('calc(var(--_max-inline-size) * var(--_max-column-count-spread))')
  })

  it('honors explicit page column counts on narrow viewports', () => {
    expect(resolvePaginatedColumnCount('paginated', 1, 874, 1250)).toBe(1)
    expect(resolvePaginatedColumnCount('paginated', 2, 874, 1250)).toBe(2)
    expect(resolvePaginatedColumnCount('paginated', 3, 874, 1250)).toBe(3)
    expect(resolvePaginatedColumnCount('scrolled', 3, 874, 1250)).toBe(1)
    expect(resolvePaginatedColumnCount('paginated', 0, 874, 1250)).toBe(1)
  })

  it('exposes a renderer-relative pan position', async () => {
    const renderer = document.createElement('foliate-paginator') as InstanceType<typeof Paginator>
    const container = renderer.shadowRoot?.querySelector('#container') as HTMLElement
    container.scrollLeft = 20

    await renderer.pan(15, 0)

    expect(renderer.containerPosition).toBe(35)
  })

  it('uses the document root background when the body is transparent', () => {
    const rootStyle = { background: 'rgb(12, 34, 56)' }
    const bodyStyle = {
      background: 'rgba(0, 0, 0, 0) none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
    }
    const doc = {
      body: {},
      documentElement: {},
      defaultView: {
        getComputedStyle: vi.fn(),
      },
    } as unknown as Document
    doc.defaultView.getComputedStyle = vi.fn(element => element === doc.body ? bodyStyle : rootStyle)

    expect(getDocumentBackground(doc)).toContain('rgb(12, 34, 56)')
  })

  it('bounds the continuous-scroll window without trimming the active section', () => {
    expect(continuousScrollTrimBefore(
      [[4, 900], [5, 900], [6, 900], [7, 900]],
      7,
      2900,
      1800,
    )).toEqual([4])
    expect(continuousScrollTrimBefore(
      [[4, 900], [5, 900], [6, 900], [7, 900]],
      7,
      1900,
      1800,
    )).toEqual([])
  })

  it('requires a second same-direction wheel segment at a snap boundary', () => {
    expect(snapWheelStep(0, 100, 150)).toEqual({ accumulated: 100, direction: 0 })
    expect(snapWheelStep(100, 100, 150)).toEqual({ accumulated: 0, direction: 1 })
    expect(snapWheelStep(100, -20, 150)).toEqual({ accumulated: -20, direction: 0 })
  })

  it('releases the navigation lock after a failed section turn', async () => {
    const renderer = document.createElement('foliate-paginator') as InstanceType<typeof Paginator>
    renderer.open({ sections: [] })

    await expect(renderer.next()).rejects.toThrow()
    await expect(renderer.next()).rejects.toThrow()
  })
})
