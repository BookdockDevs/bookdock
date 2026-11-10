import DOMPurify from 'dompurify'

export function securePublicationMarkup(source: string, mediaType: string): string {
  let doc = new DOMParser().parseFromString(source, mediaType as DOMParserSupportedType)
  if (doc.querySelector('parsererror')) {
    if (mediaType === 'image/svg+xml') throw new Error('Invalid SVG resource')
    doc = new DOMParser().parseFromString(source, 'text/html')
  }
  const svg = mediaType === 'image/svg+xml'
  // Keep neighboring element indices stable for CFI while disabling active content.
  for (const element of Array.from(doc.querySelectorAll('script, iframe, object, embed, base, form'))) {
    const placeholder = doc.createElementNS(svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', svg ? 'g' : 'span')
    if (element.localName === 'form') while (element.firstChild) placeholder.append(element.firstChild)
    else placeholder.setAttribute('hidden', '')
    element.replaceWith(placeholder)
  }
  for (const meta of Array.from(doc.querySelectorAll('meta'))) {
    if (meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh') { meta.removeAttribute('http-equiv'); meta.removeAttribute('content') }
  }
  DOMPurify.sanitize(doc.documentElement, {
    IN_PLACE: true,
    WHOLE_DOCUMENT: !svg,
    USE_PROFILES: svg ? { svg: true, svgFilters: true } : { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['link', 'meta'],
    ADD_ATTR: ['epub:type', 'epub:prefix', 'xml:lang', 'xmlns:epub', 'property', 'content', 'http-equiv'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|blob|mailto|tel|sms|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_ATTR: ['srcdoc'],
  })
  if (!svg) {
    const head = doc.querySelector('head') ?? doc.documentElement.insertBefore(doc.createElementNS('http://www.w3.org/1999/xhtml', 'head'), doc.documentElement.firstChild)
    const policy = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta')
    policy.setAttribute('http-equiv', 'Content-Security-Policy')
    policy.setAttribute('content', "script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
    head.prepend(policy)
  }
  return new XMLSerializer().serializeToString(doc)
}
