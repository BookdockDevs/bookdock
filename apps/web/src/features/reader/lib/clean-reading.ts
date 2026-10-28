export function shouldSkipCleanReadingResource(type = '', href = ''): boolean {
  const normalizedType = type.toLowerCase().split(';', 1)[0].trim()
  if (normalizedType === 'text/css') return true
  if (normalizedType.startsWith('font/') || normalizedType === 'application/font-woff'
    || normalizedType === 'application/font-woff2' || normalizedType === 'application/vnd.ms-opentype') return true
  if (normalizedType.startsWith('image/') || normalizedType.startsWith('audio/') || normalizedType.startsWith('video/')) return true
  if (normalizedType === 'application/vnd.apple.mpegurl' || normalizedType === 'application/x-mpegurl') return true
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp|ico|mp3|m4a|ogg|wav|flac|aac|mp4|m4v|mov|webm|ogv|woff2?|ttf|otf|eot)(?:[?#].*)?$/i.test(href)
}

export function sanitizeCleanReadingMarkup(source: string, mediaType = 'application/xhtml+xml'): string {
  const doc = new DOMParser().parseFromString(source, mediaType as DOMParserSupportedType)
  if (!doc.documentElement || doc.querySelector('parsererror')) return source

  // Some books put presentation nodes in the body; retain their element
  // positions so stripping presentation does not shift existing CFI paths.
  for (const style of Array.from(doc.querySelectorAll('style'))) style.textContent = ''
  for (const link of Array.from(doc.querySelectorAll('link'))) {
    if (/\bstylesheet\b/i.test(link.getAttribute('rel') ?? '')) link.removeAttribute('href')
  }
  for (const element of Array.from(doc.querySelectorAll('[style]'))) element.removeAttribute('style')
  for (const element of Array.from(doc.querySelectorAll('img, svg, video, audio, canvas, object, embed, iframe, source, track'))) {
    for (const attribute of ['src', 'srcset', 'poster', 'data', 'href', 'xlink:href']) element.removeAttribute(attribute)
    element.setAttribute('data-bd-clean-hidden', '')
  }

  return new XMLSerializer().serializeToString(doc)
}
