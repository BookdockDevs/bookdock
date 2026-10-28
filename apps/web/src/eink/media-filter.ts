const MEDIA_PATH = /\.(?:aac|flac|m4a|mp3|mp4|m4v|mpeg|mpg|mov|oga|ogg|ogv|opus|wav|webm|3gp)(?:[?#]|$)/i
const MEDIA_TYPE = /^(?:audio\/|video\/|application\/ogg(?:;|$))/i
const XHTML = 'http://www.w3.org/1999/xhtml'

export function isEinkMedia(type: string, path: string): boolean {
  return MEDIA_TYPE.test(type.trim()) || MEDIA_PATH.test(path)
}

export function filterEinkMedia(markup: string, mediaType: string): string {
  if (!/^(?:application\/xhtml\+xml|text\/html)$/i.test(mediaType) || !/<(?:audio|video|object|embed)\b/i.test(markup)) return markup
  let isHtml = mediaType.toLowerCase() === 'text/html'
  let doc = new DOMParser().parseFromString(markup, isHtml ? 'text/html' : 'application/xhtml+xml')
  if (!isHtml && (doc.querySelector('parsererror') || !doc.documentElement?.namespaceURI)) {
    isHtml = true
    doc = new DOMParser().parseFromString(markup, 'text/html')
  }
  const media = Array.from(doc.querySelectorAll('audio, video, object, embed'))
  let changed = false
  for (const item of media) {
    const tag = item.localName.toLowerCase()
    if ((tag === 'object' || tag === 'embed') && !isEinkMedia(item.getAttribute('type') ?? '', item.getAttribute('data') ?? item.getAttribute('src') ?? '')) continue
    const replacement = doc.createElementNS(XHTML, 'span')
    for (const attribute of Array.from(item.attributes)) {
      if (/^(?:src|data|type|poster|controls|autoplay|preload|loop|muted|playsinline)$/i.test(attribute.name)) continue
      replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    }
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === 1 && /^(?:source|track)$/i.test((child as Element).localName)) {
        const placeholder = doc.createElementNS(XHTML, 'span')
        placeholder.setAttribute('hidden', '')
        replacement.appendChild(placeholder)
      } else {
        replacement.appendChild(child)
      }
    }
    const poster = tag === 'video' ? item.getAttribute('poster') : null
    if (poster) {
      const image = doc.createElementNS(XHTML, 'img')
      image.setAttribute('src', poster)
      image.setAttribute('alt', '')
      replacement.appendChild(image)
    }
    item.parentNode?.replaceChild(replacement, item)
    changed = true
  }
  if (!changed) return markup
  if (isHtml) return '<!DOCTYPE html>' + doc.documentElement.outerHTML
  return new XMLSerializer().serializeToString(doc)
}
