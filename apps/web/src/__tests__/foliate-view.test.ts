import { beforeAll, describe, expect, it, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('foliate view renderer search contract', () => {
  let View: typeof import('../../public/foliate-js/view.js').View

  beforeAll(async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
    ;({ View } = await import('../../public/foliate-js/view.js'))
  })

  it('keeps nearby-words subranges as separate CFI highlights', async () => {
    const doc = document.implementation.createHTMLDocument('search')
    doc.body.innerHTML = '<p>alpha one beta</p>'
    const book = {
      metadata: { language: 'en' },
      rendition: { layout: 'reflowable' },
      sections: [{
        cfi: 'epubcfi(/6/2[chapter])',
        createDocument: async () => doc,
      }],
      dir: 'ltr',
    }
    const view = new View()
    await view.open(book as never)

    const results = []
    for await (const result of view.search({
      query: 'alpha beta',
      index: 0,
      mode: 'nearby-words',
      nearbyWords: 2,
    })) results.push(result)

    const match = results.find(result => typeof result === 'object' && 'cfi' in result) as { cfis?: string[] } | undefined
    expect(match?.cfis).toHaveLength(2)

    view.renderer.remove()
  })

  it('draws search hits as theme-colored highlights instead of outlines', async () => {
    const { Overlayer } = await import('../../public/foliate-js/overlayer.js')
    const doc = document.implementation.createHTMLDocument('search-highlight')
    doc.body.innerHTML = '<p>alpha beta</p>'
    const range = doc.createRange()
    range.selectNodeContents(doc.body.firstChild!)
    const overlayer = { add: vi.fn() }
    const view = new View()
    ;(view as any).renderer = {
      getContents: () => [{ index: 0, doc, overlayer }],
    }
    ;(view as any).resolveNavigation = vi.fn().mockResolvedValue({
      index: 0,
      anchor: () => range,
    })

    await view.addAnnotation({ value: 'foliate-search:epubcfi(/6/2!/4/2)' })

    expect(overlayer.add).toHaveBeenCalledWith(
      'foliate-search:epubcfi(/6/2!/4/2)',
      range,
      Overlayer.highlight,
      { color: 'var(--bd-search-highlight, #facc15)', fillOpacity: 0.32 },
    )

    await view.addAnnotation({ value: 'foliate-search-active:epubcfi(/6/2!/4/2)' })

    expect(overlayer.add).toHaveBeenCalledWith(
      'foliate-search-active:epubcfi(/6/2!/4/2)',
      range,
      Overlayer.highlight,
      {
        color: 'var(--bd-search-active-highlight, #fbbf24)',
        fillOpacity: 0.4,
        stroke: 'var(--bd-search-active-border, #d97706)',
        strokeWidth: 1.5,
        strokeOpacity: 0.9,
      },
    )
  })

  it('emits create-overlay after the overlay is attached', async () => {
    const doc = document.implementation.createHTMLDocument('overlay-lifecycle')
    doc.body.innerHTML = '<p>正文</p>'
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      sections: [{ createDocument: async () => doc }],
      dir: 'ltr',
    }
    const view = new View()
    let attachedOverlayer: unknown
    const attachedStates: boolean[] = []
    view.addEventListener('create-overlay', (event) => {
      const index = (event as CustomEvent).detail?.index
      attachedStates.push(index === 0 && !!attachedOverlayer)
    })

    await view.open(book as never)
    ;(view.renderer as any).getContents = () => [{ index: 0, overlayer: attachedOverlayer }]
    view.renderer.dispatchEvent(new CustomEvent('create-overlayer', {
      detail: {
        doc,
        index: 0,
        attach: (overlayer: unknown) => { attachedOverlayer = overlayer },
      },
    }))

    expect(attachedStates.length).toBeGreaterThan(0)
    expect(attachedStates.every(Boolean)).toBe(true)
    view.close()
    view.remove()
  })

  it('forwards renderer stabilization after the initial layout settles', async () => {
    const doc = document.implementation.createHTMLDocument('stabilized')
    doc.body.innerHTML = '<p>正文</p>'
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      sections: [{ createDocument: async () => doc }],
      dir: 'ltr',
    }
    const view = new View()
    const stabilized = vi.fn()
    view.addEventListener('stabilized', stabilized)

    await view.open(book as never)
    view.renderer.dispatchEvent(new Event('stabilized'))

    expect(stabilized).toHaveBeenCalledTimes(1)
    view.close()
    view.remove()
  })

  it('classifies annotation hits as handled by the overlay, not generic content clicks', async () => {
    const { isInteractiveAnnotationHit } = await import('../../public/foliate-js/view.js')
    const overlayer = { hitTest: vi.fn().mockReturnValue(['foliate-note:epubcfi(/6/2)']) }
    const searchOverlayer = { hitTest: vi.fn().mockReturnValue(['foliate-search:epubcfi(/6/2)']) }
    const activeSearchOverlayer = { hitTest: vi.fn().mockReturnValue(['foliate-search-active:epubcfi(/6/2)']) }

    expect(isInteractiveAnnotationHit(overlayer, { x: 10, y: 20 })).toBe(true)
    expect(isInteractiveAnnotationHit(searchOverlayer, { x: 10, y: 20 })).toBe(false)
    expect(isInteractiveAnnotationHit(activeSearchOverlayer, { x: 10, y: 20 })).toBe(false)
    expect(isInteractiveAnnotationHit(null, { x: 10, y: 20 })).toBe(false)
  })

  it('keeps the renderer chapter location in relocate details', async () => {
    const doc = document.implementation.createHTMLDocument('chapter-location')
    doc.body.innerHTML = '<p>正文</p>'
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      sections: [{ createDocument: async () => doc }],
      dir: 'ltr',
    }
    const view = new View()
    await view.open(book as never)
    Object.defineProperties(view.renderer, {
      page: { configurable: true, value: 3 },
      pages: { configurable: true, value: 8 },
    })
    const onRelocate = vi.fn()
    view.addEventListener('relocate', event => onRelocate((event as CustomEvent).detail))
    view.renderer.dispatchEvent(new CustomEvent('relocate', {
      detail: { reason: 'page', index: 0, fraction: 0.5, size: 1 },
    }))

    expect(onRelocate).toHaveBeenCalledWith(expect.objectContaining({
      chapterLocation: { current: 3, total: 6 },
    }))
    view.close()
  })

  it('supplies the default Media Overlay active class', async () => {
    const doc = document.implementation.createHTMLDocument('media-overlay')
    doc.body.innerHTML = '<p>正文</p>'
    const mediaOverlay = new EventTarget()
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      media: {},
      getMediaOverlay: () => mediaOverlay,
      sections: [{ mediaOverlay: true, createDocument: async () => doc }],
      dir: 'ltr',
    }
    const view = new View()
    await view.open(book as never)

    expect((book.media as { activeClass?: string }).activeClass).toBe('-epub-media-overlay-active')
    view.close()
  })

  it('ignores errors from deferred media until a playable source is bound', async () => {
    const doc = document.implementation.createHTMLDocument('deferred-media')
    doc.body.innerHTML = '<video><source data-bd-deferred-src="movie.mp4"></video>'
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      sections: [{ createDocument: async () => doc }],
      dir: 'ltr',
    }
    const view = new View()
    await view.open(book as never)
    view.renderer.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 0 } }))

    const onMediaError = vi.fn()
    view.addEventListener('media-error', (event) => onMediaError((event as CustomEvent).detail))
    const video = doc.querySelector('video')!
    const source = doc.querySelector('source')!

    video.dispatchEvent(new Event('error'))
    expect(onMediaError).not.toHaveBeenCalled()
    expect(video.dataset.bookdockMediaError).toBeUndefined()

    source.setAttribute('src', 'blob:http://localhost/movie.mp4')
    video.dispatchEvent(new Event('error'))
    expect(onMediaError).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'video',
      src: 'blob:http://localhost/movie.mp4',
    }))

    view.close()
  })

  it('emits open-media event when clicking an SVG cover image without throwing NS reference error', async () => {
    const doc = document.implementation.createHTMLDocument('cover')
    doc.body.innerHTML = `
      <div id="cover-container">
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 600 800">
          <image width="600" height="800" href="cover.jpeg" xlink:href="cover.jpeg" />
        </svg>
      </div>
    `
    const book = {
      metadata: { language: 'zh-CN' },
      rendition: { layout: 'reflowable' },
      sections: [{
        createDocument: async () => doc,
      }],
      dir: 'ltr',
    }
    const view = new View()
    await view.open(book as never)
    view.renderer.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 0 } }))

    const onOpenMedia = vi.fn()
    view.addEventListener('open-media', (e: Event) => onOpenMedia((e as CustomEvent).detail))

    const svg = doc.querySelector('svg')!
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onOpenMedia).toHaveBeenCalledWith(expect.objectContaining({
      src: expect.stringContaining('cover.jpeg'),
      kind: 'svg-image',
    }))

    view.close()
  })
})
