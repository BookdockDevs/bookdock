export interface MediaOverlayCue {
  index: number
  textHref: string
  textFragment: string | null
  audioHref: string
  clipBegin: number | null
  clipEnd: number | null
}

export interface MediaOverlaySectionOptions {
  sectionIndex: number
  sectionHref: string
  mediaOverlayHref: string
  loadText: (href: string) => Promise<string | null> | string | null
}

function normalizePath(value: string): string {
  const path = value.split(/[?#]/, 1)[0] ?? ''
  const decoded = decodeArchivePath(path)
  const parts: string[] = []
  for (const part of decoded.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/').toLowerCase()
}

function decodeArchivePath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/%(2f|23)/gi, '%25$1'))
  } catch {
    return value
  }
}

function resolveHref(value: string, base: string): string {
  const [rawPath = '', fragment] = value.split('#', 2)
  const basePath = base.split(/[?#]/, 1)[0] ?? ''
  const baseDirectory = basePath.slice(0, basePath.lastIndexOf('/') + 1)
  const path = rawPath ? `${baseDirectory}${rawPath}` : basePath
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const resolvedPath = decodeArchivePath(parts.join('/'))
  return `${resolvedPath}${fragment ? `#${decodeFragment(fragment)}` : ''}`
}

function parseClock(value: string | null): number | null {
  if (!value) return null
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 2 && parts.every(Number.isFinite) && parts.every(value => value >= 0)) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3 && parts.every(Number.isFinite) && parts.every(value => value >= 0)) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(ms|h|min|s)?$/i)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount < 0) return null
  const unit = match[2]?.toLowerCase()
  return unit === 'h' ? amount * 3600 : unit === 'min' ? amount * 60 : unit === 'ms' ? amount / 1000 : amount
}

function childByLocalName(parent: Element, name: string): Element | null {
  return Array.from(parent.children).find(child => child.localName === name) ?? null
}

export function parseMediaOverlay(smil: string, smilHref: string): MediaOverlayCue[] {
  const doc = new DOMParser().parseFromString(smil, 'application/xml')
  if (doc.querySelector('parsererror')) return []
    const cues: MediaOverlayCue[] = []
    for (const par of Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === 'par')) {
        const text = childByLocalName(par, 'text')?.getAttribute('src')
        const audio = childByLocalName(par, 'audio')
        if (!text || !audio) continue
        const audioSrc = audio.getAttribute('src')
        if (!audioSrc) continue
    const textHref = resolveHref(text, smilHref)
    const [resolvedTextHref, textFragment = null] = textHref.split('#', 2)
    const clipBegin = parseClock(audio.getAttribute('clipBegin') ?? audio.getAttribute('clip-begin'))
    const parsedClipEnd = parseClock(audio.getAttribute('clipEnd') ?? audio.getAttribute('clip-end'))
    cues.push({
      index: cues.length,
      textHref: resolvedTextHref,
      textFragment,
      audioHref: resolveHref(audioSrc, smilHref).split('#', 1)[0]!,
      clipBegin,
      clipEnd: parsedClipEnd !== null && parsedClipEnd > (clipBegin ?? 0) ? parsedClipEnd : null,
    })
  }
  return cues
}

export function rangeForMediaOverlayCue(cue: MediaOverlayCue, sectionHref: string, doc: Document): Range | null {
  if (normalizePath(cue.textHref) !== normalizePath(sectionHref)) return null
  if (!cue.textFragment) return null
  const target = doc.getElementById(decodeFragment(cue.textFragment))
  if (!target) return null
  const walker = doc.createTreeWalker(target, 4)
  let first: Text | null = null
  let last: Text | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (!text.data.trim()) continue
    first ??= text
    last = text
  }
  if (!first || !last) return null
  const range = doc.createRange()
  range.setStart(first, first.data.length - first.data.trimStart().length)
  range.setEnd(last, last.data.trimEnd().length)
  return range
}

function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export class MediaOverlaySection {
  private cuesPromise: Promise<MediaOverlayCue[]> | null = null

  constructor(private readonly options: MediaOverlaySectionOptions) {}

  get sectionIndex() {
    return this.options.sectionIndex
  }

  get sectionHref() {
    return this.options.sectionHref
  }

  async load(): Promise<MediaOverlayCue[]> {
    this.cuesPromise ??= Promise.resolve(this.options.loadText(this.options.mediaOverlayHref))
      .then(smil => smil ? parseMediaOverlay(smil, this.options.mediaOverlayHref) : [])
    return this.cuesPromise
  }

  resolveRange(cue: MediaOverlayCue, doc: Document): Range | null {
    return rangeForMediaOverlayCue(cue, this.options.sectionHref, doc)
  }
}

export function findCueIndexForTime(cues: MediaOverlayCue[], time: number): number {
  if (cues.length === 0) return 0
  let index = 0
  for (let i = 0; i < cues.length; i++) {
    const begin = cues[i]!.clipBegin ?? (i === 0 ? 0 : cues[i - 1]!.clipEnd ?? 0)
    if (begin <= time) {
      index = i
    } else {
      break
    }
  }
  return index
}


