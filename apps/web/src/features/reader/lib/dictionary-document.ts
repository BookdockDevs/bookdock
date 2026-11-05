import DOMPurify from 'dompurify'

import { BASE_URL } from '@/api/client'

export function dictionaryResourceUrl(id: string, raw: string, base = '') {
  const value = raw.trim().replaceAll('\\', '/')
  if (!value || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)) return null
  try {
    const url = new URL(value, `https://dictionary.invalid/${base}`)
    if (url.origin !== 'https://dictionary.invalid') return null
    const key = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    return `${BASE_URL}/dictionaries/${encodeURIComponent(id)}/resource?key=${encodeURIComponent(key)}`
  } catch { return null }
}

export async function dictionaryDocument(html: string, id: string, signal: AbortSignal, theme: { bg: string; fg: string; accent: string }) {
  const document = new DOMParser().parseFromString(DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'link', 'audio'], ADD_ATTR: ['controls', 'preload'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'base', 'meta', 'svg', 'math'],
    FORBID_ATTR: ['srcset', 'ping', 'autofocus'],
    ALLOWED_URI_REGEXP: /^(?:(?:entry|bword|sound):\/\/|#|(?!(?:[a-z][a-z\d+.-]*:|\/\/|\\\\))[^<>]+$)/i,
  }), 'text/html')
  const css = (value: string, base = '') => value.replace(/@import\s+[^;]+;?/gi, '').replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote, target: string) => {
    const resource = dictionaryResourceUrl(id, target, base)
    return resource ? `url("${resource}")` : 'url("")'
  })
  for (const style of document.querySelectorAll('style')) style.textContent = css(style.textContent ?? '')
  for (const link of document.querySelectorAll('link')) {
    const href = link.getAttribute('href') ?? ''
    const url = dictionaryResourceUrl(id, href)
    if (link.getAttribute('rel') === 'stylesheet' && url) {
      try {
        const response = await fetch(url, { signal, credentials: 'same-origin' })
        if (response.ok) {
          const style = document.createElement('style')
          style.textContent = css(await response.text(), href.replaceAll('\\', '/').replace(/[^/]*$/, ''))
          link.replaceWith(style)
          continue
        }
      } catch (error) { if (signal.aborted) throw error }
    }
    link.remove()
  }
  for (const element of document.querySelectorAll('[style]')) element.setAttribute('style', css(element.getAttribute('style') ?? ''))
  for (const element of document.querySelectorAll('[src]')) {
    const url = dictionaryResourceUrl(id, element.getAttribute('src') ?? '')
    if (url && ['IMG', 'AUDIO', 'SOURCE'].includes(element.tagName)) element.setAttribute('src', url)
    else element.removeAttribute('src')
  }
  for (const anchor of document.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? ''
    if (/^(entry|bword):\/\//i.test(href)) {
      try { anchor.dataset.dictionaryEntry = decodeURIComponent(href.replace(/^(entry|bword):\/\//i, '')).slice(0, 100) } catch { /* Invalid encoded entry links are inert. */ }
      anchor.setAttribute('href', '#')
    } else if (/^sound:\/\//i.test(href)) {
      const url = dictionaryResourceUrl(id, href.replace(/^sound:\/\//i, ''))
      if (url) {
        anchor.dataset.soundSrc = url
        anchor.setAttribute('href', '#')
        anchor.setAttribute('role', 'button')
        anchor.setAttribute('tabindex', '0')
        anchor.setAttribute('title', '发音')
        if (!anchor.textContent?.trim() && !anchor.querySelector('img, svg')) {
          anchor.innerHTML = '<svg class="dict-speaker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>'
        }
      } else anchor.removeAttribute('href')
    } else if (!href.startsWith('#')) anchor.removeAttribute('href')
    anchor.removeAttribute('target')
  }
  for (const audio of document.querySelectorAll('audio')) { audio.controls = true; audio.preload = 'none'; audio.removeAttribute('autoplay') }
  const resourcePrefix = `${location.origin}${BASE_URL}/dictionaries/${encodeURIComponent(id)}/resource`
  const csp = `default-src 'none'; img-src ${resourcePrefix}; media-src ${resourcePrefix}; font-src ${resourcePrefix}; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'`
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', csp)
  document.head.prepend(meta)
  const themeStyle = document.createElement('style')
  themeStyle.textContent = `html{color-scheme:light dark;background:${theme.bg};color:${theme.fg}}body{margin:0;padding:12px 16px;font:14px/1.7 system-ui;overflow-wrap:anywhere}img{max-width:100%;height:auto;vertical-align:middle}audio{max-width:100%}a{color:${theme.accent}}a[data-sound-src]{cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;vertical-align:middle;margin:0 2px}a[data-sound-src]:hover{opacity:0.75}a[data-sound-src]:active{transform:scale(0.95)}pre{white-space:pre-wrap}table{max-width:100%}`
  document.head.append(themeStyle)
  return '<!doctype html>' + document.documentElement.outerHTML
}
