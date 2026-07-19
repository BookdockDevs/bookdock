import type { ChineseConversion } from '../features/reader/types'

// opencc-js uses a Converter factory; converters are synchronous and internally cache the dictionary.
let s2t: ((text: string) => string) | null = null
let t2s: ((text: string) => string) | null = null

async function init() {
  if (s2t && t2s) return
  const { Converter } = await import('opencc-js')
  s2t = Converter({ from: 'cn', to: 'tw' })
  t2s = Converter({ from: 'tw', to: 'cn' })
}

export async function convertChinese(text: string, mode: ChineseConversion): Promise<string> {
  if (mode === 'off') return text
  await init()
  if (mode === 'simplified') return t2s!(text)
  return s2t!(text)
}
