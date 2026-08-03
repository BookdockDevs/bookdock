import type { ChineseConversion } from '../features/reader/types'

// opencc-js uses a Converter factory; converters are synchronous and
// internally cache the dictionary.
let s2t: ((text: string) => string) | null = null
let t2s: ((text: string) => string) | null = null

async function init() {
  if (s2t && t2s) return
  const { Converter } = await import('opencc-js')
  s2t = Converter({ from: 'cn', to: 'tw' })
  // 't' (generic traditional), not 'tw': the tw->cn chain includes the Taiwan
  // variant table, which rewrites already-simplified text (e.g. 什么 -> 什幺).
  t2s = Converter({ from: 't', to: 'cn' })
}

// Converters are synchronous once opencc-js is loaded; the async wrapper only
// pays for the one-time dynamic import. Conversion always derives from the
// input text, so callers must pass the original (never already-converted
// text, which opencc phrase rules drift on).
export async function convertChinese(text: string, mode: ChineseConversion): Promise<string> {
  if (mode === 'off') return text
  await init()
  const converter = mode === 'simplified' ? t2s! : s2t!
  return converter(text)
}
