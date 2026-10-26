import { uploadedFaceCss, type ResolvedFont } from '../../fonts'

async function readFontRules(css: string, base: string, signal?: AbortSignal, ancestors = new Set<string>()): Promise<string[]> {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = (css.match(/@font-face\s*\{[^}]*\}/gi) ?? []).map((rule) =>
    rule.replace(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi, (_, url: string) => `url("${new URL(url, base).href}")`),
  )
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|['"]([^'"]+)['"])[^;]*;/gi)]
  const imported = await Promise.all(imports.map(async (match) => {
    const url = new URL(match[1] ?? match[2], base).href
    if (ancestors.has(url)) return []
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error('card font stylesheet unavailable')
    return readFontRules(await response.text(), url, signal, new Set([...ancestors, url]))
  }))
  return [...rules, ...imported.flat()]
}

/** Read only the selected font sources: CSSOM access to CDN stylesheets can
 * fail even when the browser can render them in the live document. */
export async function embedCardFonts(fonts: ResolvedFont[], text: string, signal?: AbortSignal): Promise<string> {
  const sources = new Map<string, ResolvedFont>()
  for (const font of fonts) {
    if (font.builtin || font.uploaded) sources.set(font.stack, font)
  }
  const dataUrls = new Map<string, Promise<string>>()
  return (await Promise.all([...sources.values()].map(async (font) => {
    const base = font.builtin?.cssUrl ?? window.location.href
    const response = font.builtin ? await fetch(base, { signal }) : null
    if (response && !response.ok) throw new Error('card font stylesheet unavailable')
    const css = response ? await response.text() : uploadedFaceCss(font.uploaded!)
    const family = font.stack.split(',')[0].trim().replace(/['"]/g, '')
    const rules = (await readFontRules(css, base, signal, new Set([base]))).filter((rule) =>
      rule.match(/font-family\s*:\s*([^;}]+)/i)?.[1].trim().replace(/['"]/g, '') === family,
    )
    if (!rules.length) throw new Error('card font declarations unavailable')
    const points = Array.from(text, (char) => char.codePointAt(0)!)
    return (await Promise.all(rules.map(async (rule) => {
      const range = rule.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1]
      if (range && !range.split(',').some((part) => {
        const match = part.trim().match(/^U\+([\da-f?]+)(?:-([\da-f]+))?$/i)
        if (!match) return true
        const start = parseInt(match[1].replace(/\?/g, '0'), 16)
        const end = parseInt(match[2] ?? match[1].replace(/\?/g, 'f'), 16)
        return points.some((point) => point >= start && point <= end)
      })) return ''
      const urls = [...rule.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)]
      for (const match of urls) {
        const url = new URL(match[1], base).href
        let pending = dataUrls.get(url)
        if (!pending) {
          pending = fetch(url, { signal }).then(async (res) => {
            if (!res.ok) throw new Error('card font file unavailable')
            const blob = await res.blob()
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(new Error('card font encoding failed'))
              reader.readAsDataURL(blob)
            })
          })
          dataUrls.set(url, pending)
        }
        rule = rule.replace(match[0], `url("${await pending}")`)
      }
      return rule
    }))).join('\n')
  }))).join('\n')
}
