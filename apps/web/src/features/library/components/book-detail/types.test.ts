import { describe, expect, it } from 'vitest'

import { formatWordCount } from './types'

const templates: Record<string, string> = {
  'library.tocRuleWords': '{{count}} 字',
  'library.tocRuleWordsK': '{{count}}k 字',
  'library.bookWordsWan': '{{count}}万字',
}

function t(key: string, vars?: Record<string, string | number>): string {
  return (templates[key] ?? key).replace('{{count}}', String(vars?.count ?? ''))
}

describe('formatWordCount', () => {
  it('shows exact counts below the compact threshold', () => {
    expect(formatWordCount(999, 'zh-CN', t)).toBe('999 字')
    expect(formatWordCount(999, 'en', t)).toBe('999 字')
  })

  it('uses 万字 above ten thousand in Chinese', () => {
    expect(formatWordCount(454385, 'zh-CN', t)).toBe('45.4万字')
    expect(formatWordCount(100000, 'zh-CN', t)).toBe('10万字')
    expect(formatWordCount(100000, 'zh-TW', t)).toBe('10万字')
  })

  it('uses k words above one thousand outside Chinese', () => {
    expect(formatWordCount(1500, 'en', t)).toBe('1.5k 字')
    expect(formatWordCount(454385, 'en', t)).toBe('454.4k 字')
  })
})
