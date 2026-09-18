import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { EPUB } from '../../public/foliate-js/epub.js'

function pathKey(value: string): string {
  return value.replace(/\\/g, '/').split(/[?#]/, 1)[0]!.toLowerCase()
}

describe('vendored EPUB compatibility baseline', () => {
  it('loads extended EPUB metadata, TOC, case-mismatched resources, and cover pages', async () => {
    const text = new Map<string, string>([
      ['meta-inf/container.xml', `<?xml version="1.0"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OPS/package.opf" media-type="APPLICATION/OEBPS-PACKAGE+XML"/></rootfiles>
        </container>`],
      ['ops/package.opf', `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
          <metadata>
            <dc:title id="main">主标题</dc:title>
            <dc:title id="sub">副标题</dc:title>
            <dc:creator id="author">作者</dc:creator>
            <dc:language>zh-CN</dc:language><dc:language>en</dc:language>
            <meta refines="#main" property="title-type">main</meta>
            <meta refines="#sub" property="title-type">subtitle</meta>
            <meta refines="#author" property="role">aut</meta>
            <meta property="dcterms:modified">2026-09-14T08:00:00Z</meta>
            <meta name="cover" content="cover-page"/>
          </metadata>
          <manifest>
            <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
            <item id="cover-image" href="images/cover.jpg" media-type="IMAGE/JPEG"/>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="NAV"/>
            <item id="chapter" href="Text/Chapter.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`],
      ['ops/cover.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/COVER.JPG"/></body></html>'],
      ['ops/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/chapter.xhtml#start">第一章</a></li></ol></nav><nav epub:type="page-list"><ol><li><a href="text/chapter.xhtml">1</a></li></ol></nav></body></html>'],
      ['ops/text/chapter.xhtml', '<html><body><p id="start">正文</p></body></html>'],
    ].map(([key, value]) => [pathKey(key), value]))
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const blobs = new Map([['ops/images/cover.jpg', new Blob([coverBytes], { type: 'image/jpeg' })]])
    const entries = [...text.keys(), 'OPS/images/cover.jpg'].map((filename) => ({ filename }))
    const loadText = async (name: string) => text.get(pathKey(name)) ?? null
    const loadBlob = async (name: string) => blobs.get(pathKey(name)) ?? null

    const book = await new EPUB({
      entries,
      loadText,
      loadBlob,
      getSize: () => 1,
    }).init()

    expect(book.metadata).toMatchObject({
      title: '主标题',
      subtitle: '副标题',
      language: ['zh-CN', 'en'],
      modified: '2026-09-14T08:00:00Z',
      author: '作者',
    })
    expect(book.sections).toHaveLength(1)
    expect(book.toc?.[0]).toMatchObject({ label: '第一章', href: 'OPS/text/chapter.xhtml#start' })
    expect(book.resolveHref('OPS/text/CHAPTER.XHTML#start')?.index).toBe(0)
    expect(await book.getCover()).toMatchObject({ type: 'image/jpeg', size: 4 })
  })

  it('keeps missing optional fonts and images as non-blocking original references', async () => {
    const text = new Map<string, string>([
      ['meta-inf/container.xml', `<?xml version="1.0"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`],
      ['ops/package.opf', `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
          <metadata><dc:title>缺失资源</dc:title></metadata>
          <manifest>
            <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="style" href="Styles/book.css" media-type="text/css"/>
            <item id="missing-image" href="Images/missing.png" media-type="image/png"/>
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`],
      ['ops/text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/book.css"/></head><body><img src="../Images/missing.png"/><p>正文</p></body></html>'],
      ['ops/styles/book.css', '@font-face { font-family: missing; src: url("../Fonts/missing.ttf"); } body { font-family: missing; }'],
    ].map(([key, value]) => [pathKey(key), value]))
    const entries = [...text.keys()].map((filename) => ({ filename }))
    const loadText = async (name: string) => text.get(pathKey(name)) ?? null
    const loadBlob = async () => null
    const created: Blob[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob)
        return `blob:missing-resource-${created.length}`
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => {},
    })

    try {
      const book = await new EPUB({ entries, loadText, loadBlob, getSize: () => 1 }).init()
      const content = await book.sections[0]!.loadContent()
      const css = created.find(blob => blob.type === 'text/css')

      expect(content).toContain('missing.png')
      expect(css).toBeDefined()
      expect(await css!.text()).toContain('../Fonts/missing.ttf')
      expect(created).toHaveLength(2)
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('loads unlisted local resources from the archive with inferred media types', async () => {
    const text = new Map<string, string>([
      ['meta-inf/container.xml', `<?xml version="1.0"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`],
      ['ops/package.opf', `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
          <metadata><dc:title>漏列资源</dc:title></metadata>
          <manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`],
      ['ops/text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/unlisted.css"/></head><body><img src="../Images/diagram.svg"/><p>正文</p></body></html>'],
      ['ops/styles/unlisted.css', 'body { color: red; }'],
      ['ops/images/diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ].map(([key, value]) => [pathKey(key), value]))
    const entries = [...text.keys()].map((filename) => ({ filename }))
    const loadText = async (name: string) => text.get(pathKey(name)) ?? null
    const loadBlob = async () => null
    const created: Blob[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob)
        return `blob:unlisted-resource-${created.length}`
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => {},
    })

    try {
      const book = await new EPUB({ entries, loadText, loadBlob, getSize: () => 1 }).init()
      const content = await book.sections[0]!.loadContent()

      expect(created.map(blob => blob.type), content).toEqual(expect.arrayContaining([
        'text/css',
        'image/svg+xml',
      ]))
      expect(content).toContain('blob:unlisted-resource-')
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('denies script resources by default while allowing an explicit core policy', async () => {
    const text = new Map<string, string>([
      ['meta-inf/container.xml', `<?xml version="1.0"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`],
      ['ops/package.opf', `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
          <metadata><dc:title>脚本策略</dc:title></metadata>
          <manifest>
            <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="script" href="Scripts/book.js" media-type="text/javascript"/>
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>`],
      ['ops/text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><script src="../Scripts/book.js"/><p>正文</p></body></html>'],
      ['ops/scripts/book.js', 'window.bookScriptRan = true'],
    ].map(([key, value]) => [pathKey(key), value]))
    const entries = [...text.keys()].map((filename) => ({ filename }))
    const scriptReads: string[] = []
    const loadText = async (name: string) => {
      if (pathKey(name).endsWith('/scripts/book.js')) scriptReads.push(name)
      return text.get(pathKey(name)) ?? null
    }
    const loadBlob = async () => null
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:script-policy',
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => {},
    })

    try {
      const denied = await new EPUB({ entries, loadText, loadBlob, getSize: () => 1 }).init()
      await denied.sections[0]!.loadContent()
      expect(scriptReads).toHaveLength(0)

      const allowed = await new EPUB({
        entries, loadText, loadBlob, getSize: () => 1, allowScript: true,
      }).init()
      await allowed.sections[0]!.loadContent()
      expect(scriptReads).toHaveLength(1)
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('repairs unclosed XHTML void elements without losing the XHTML document', async () => {
    const text = new Map([
      ['META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
      ['OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Void</dc:title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="Images/cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['OPS/Text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before<br><img src="../Images/cover.jpg">After</p></body></html>'],
    ])
    const requested: string[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:void-image' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })

    try {
      const book = await new EPUB({
        entries: [...text.keys(), 'OPS/Images/cover.jpg'].map(filename => ({ filename })),
        loadText: async (name: string) => text.get(name) ?? null,
        loadBlob: async (name: string) => {
          requested.push(name)
          return name === 'OPS/Images/cover.jpg' ? new Blob(['image'], { type: 'image/jpeg' }) : null
        },
        getSize: () => 1,
      }).init()
      const content = await book.sections[0]!.loadContent()
      const doc = new DOMParser().parseFromString(content, 'application/xhtml+xml')

      expect(doc.querySelector('parsererror')).toBeNull()
      expect(doc.querySelector('br')).not.toBeNull()
      expect(doc.querySelector('img')?.getAttribute('src')).toBe('blob:void-image')
      expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
      expect(requested).toEqual(['OPS/Images/cover.jpg'])
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('uses a unique case-insensitive manifest href before archive fallback', async () => {
    const text = new Map([
      ['META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
      ['OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Case</dc:title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="Images/Cover.JPG" media-type="image/jpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['OPS/Text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../images/COVER.JPG"/></body></html>'],
    ])
    const requested: string[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:case-image' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })

    try {
      const book = await new EPUB({
        entries: [...text.keys(), 'OPS/Images/Cover.JPG'].map(filename => ({ filename })),
        loadText: async (name: string) => text.get(name) ?? null,
        loadBlob: async (name: string) => {
          requested.push(name)
          return name === 'OPS/Images/Cover.JPG' ? new Blob(['image'], { type: 'image/jpeg' }) : null
        },
        getSize: () => 1,
      }).init()
      await book.sections[0]!.loadContent()
      expect(requested).toEqual(['OPS/Images/Cover.JPG'])
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('does not guess an ambiguous unmanifested archive resource', async () => {
    const text = new Map([
      ['META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
      ['OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Ambiguous</dc:title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['OPS/Text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../images/cover.png"/></body></html>'],
    ])
    const requested: string[] = []
    const book = await new EPUB({
      entries: [...text.keys(), 'OPS/Images/Cover.png', 'OPS/Images/cover.png'].map(filename => ({ filename })),
      loadText: async (name: string) => text.get(name) ?? null,
      loadBlob: async (name: string) => {
        requested.push(name)
        return new Blob(['image'], { type: 'image/png' })
      },
      getSize: () => 1,
    }).init()

    await book.sections[0]!.loadContent()

    expect(requested).toHaveLength(0)
  })

  it('exposes section resource loading for dynamically inserted media', async () => {
    const text = new Map([
      ['META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
      ['OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>动态媒体</dc:title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="media" href="Media/clip.mp4" media-type="video/mp4"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['OPS/Text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p></body></html>'],
    ])
    const requested: string[] = []
    const revoked: string[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:dynamic-media',
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (url: string) => revoked.push(url),
    })

    try {
      const book = await new EPUB({
        entries: [...text.keys(), 'OPS/Media/clip.mp4'].map(filename => ({ filename })),
        loadText: async (name: string) => text.get(name) ?? null,
        loadBlob: async (name: string) => {
          requested.push(name)
          return name === 'OPS/Media/clip.mp4'
            ? new Blob(['video'], { type: 'video/mp4' }) : null
        },
        getSize: () => 1,
      }).init()
      const section = book.sections[0]!
      expect(await section.loadHref('../Media/clip.mp4')).toBe('blob:dynamic-media')
      const doc = new DOMParser().parseFromString(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>',
        'application/xhtml+xml',
      )
      const dispose = section.observeDynamicResources(doc)
      const video = doc.createElement('video')
      const source = doc.createElement('source')
      source.setAttribute('src', '../Media/clip.mp4')
      video.append(source)
      doc.body.append(video)

      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(source.getAttribute('src')).toBe('blob:dynamic-media')
      expect(requested).toEqual(['OPS/Media/clip.mp4'])

      dispose()
      book.destroy()
      expect(revoked).toContain('blob:dynamic-media')
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })

  it('defers heavy media (video/audio) during loadContent to prioritize immediate text rendering', async () => {
    const text = new Map([
      ['META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
      ['OPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Media</dc:title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="poster" href="Images/poster.jpg" media-type="image/jpeg"/><item id="clip" href="Media/clip.mp4" media-type="video/mp4"/><item id="song" href="Media/song.mp3" media-type="audio/mpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`],
      ['OPS/Text/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Text Title</h1><video src="../Media/clip.mp4" poster="../Images/poster.jpg"></video><audio><source src="../Media/song.mp3" type="audio/mpeg"/></audio></body></html>'],
    ])
    const requestedBlobs: string[] = []
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => `blob:${blob.type}` })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })

    try {
      const book = await new EPUB({
        entries: [...text.keys(), 'OPS/Images/poster.jpg', 'OPS/Media/clip.mp4', 'OPS/Media/song.mp3'].map(filename => ({ filename })),
        loadText: async (name: string) => text.get(name) ?? null,
        loadBlob: async (name: string) => {
          requestedBlobs.push(name)
          if (name === 'OPS/Images/poster.jpg') return new Blob(['poster'], { type: 'image/jpeg' })
          if (name === 'OPS/Media/clip.mp4') return new Blob(['video'], { type: 'video/mp4' })
          if (name === 'OPS/Media/song.mp3') return new Blob(['audio'], { type: 'audio/mpeg' })
          return null
        },
        getSize: () => 1,
      }).init()

      const content = await book.sections[0]!.loadContent()
      const doc = new DOMParser().parseFromString(content, 'application/xhtml+xml')

      // Text and poster are loaded immediately
      expect(doc.querySelector('h1')?.textContent).toBe('Text Title')
      expect(doc.querySelector('video')?.getAttribute('poster')).toBe('blob:image/jpeg')

      // Heavy video and audio are deferred: no direct src, marked with data-bd-deferred-src
      expect(doc.querySelector('video')?.hasAttribute('src')).toBe(false)
      expect(doc.querySelector('video')?.getAttribute('data-bd-deferred-src')).toBe('../Media/clip.mp4')

      expect(doc.querySelector('audio source')?.hasAttribute('src')).toBe(false)
      expect(doc.querySelector('audio source')?.getAttribute('data-bd-deferred-src')).toBe('../Media/song.mp3')

      // Crucially, video and audio blobs were NOT requested during chapter text load
      expect(requestedBlobs).toEqual(['OPS/Images/poster.jpg'])
      expect(requestedBlobs).not.toContain('OPS/Media/clip.mp4')
      expect(requestedBlobs).not.toContain('OPS/Media/song.mp3')
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else delete (globalThis.URL as typeof URL & { createObjectURL?: unknown }).createObjectURL
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else delete (globalThis.URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL
    }
  })
})
