import { describe, expect, it } from 'vitest'

import en from '../i18n/locales/en.json'
import zhCN from '../i18n/locales/zh-CN.json'

function flatten(source: unknown, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') for (const [inner, text] of flatten(value, name)) entries.set(inner, text)
    else entries.set(name, String(value))
  }
  return entries
}

const zh = flatten(zhCN)
const english = flatten(en)
const placeholders = (value: string) => [...new Set([...value.matchAll(/{{(\w+)}}/g)].map((match) => match[1]!))].sort()

// i18next resolves plural suffixes (_one/_other/...) against the base key, so
// locales may legitimately differ in which suffixes they declare (e.g. zh has
// no plural forms). Compare plural families by base key, everything else
// literally.
const PLURAL_SUFFIX = /_(one|other|zero|two|few|many)$/
const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, '')

function missingKeys(have: Map<string, string>, need: Map<string, string>): string[] {
  const haveBases = new Set([...have.keys()].map(baseKey))
  return [...need.keys()]
    .filter((key) => !have.has(key) && !haveBases.has(baseKey(key)))
    .sort()
}

describe('i18n locale parity', () => {
  it('keeps both locales key-for-key identical, plural suffixes aside', () => {
    const missingInEnglish = missingKeys(english, zh)
    const missingInChinese = missingKeys(zh, english)
    expect(missingInEnglish).toEqual([])
    expect(missingInChinese).toEqual([])
  })

  it('keeps interpolated placeholders identical across each plural family', () => {
    // Every variant of a plural family must interpolate the same variables:
    // a corrupted suffix variant (e.g. {{total}} instead of {{count}}) would
    // otherwise ship to users in exactly the locale/form where it is picked.
    const variants = new Map<string, string[]>()
    for (const [key, value] of [...zh, ...english]) {
      const base = baseKey(key)
      variants.set(base, [...variants.get(base) ?? [], `${key}: [${placeholders(value).join(',') || 'none'}]`])
    }
    const drift: string[] = []
    for (const [base, members] of variants) {
      const sets = new Set(members.map((member) => member.slice(member.indexOf('['))))
      if (sets.size > 1) drift.push(`${base} -> ${members.join(', ')}`)
    }
    expect(drift).toEqual([])
  })
})
