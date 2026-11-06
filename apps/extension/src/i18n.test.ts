import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { localizeDocument, lookup, pickLocale } from './i18n'
import en from './i18n/messages.en'
import zhCN from './i18n/messages.zh-CN'

const root = path.dirname(fileURLToPath(import.meta.url))

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
const placeholders = (value: string) => [...value.matchAll(/{{(\w+)}}/g)].map((match) => match[1]!).sort()

describe('locale selection', () => {
  it('maps Chinese tags to the source table and everything else to English', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh_TW', 'ZH-cn']) expect(pickLocale(tag)).toBe('zh-CN')
    for (const tag of ['en', 'en-US', 'ja', 'de-DE']) expect(pickLocale(tag)).toBe('en')
    // No tag at all: tests, or a context without i18n. Keep the source language.
    expect(pickLocale('')).toBe('zh-CN')
    expect(pickLocale(undefined)).toBe('zh-CN')
  })
})

describe('message tables', () => {
  it('keeps both locales key-for-key identical, with the same placeholders', () => {
    expect([...english.keys()].sort()).toEqual([...zh.keys()].sort())
    for (const key of zh.keys()) {
      expect(placeholders(zh.get(key)!)).toEqual(placeholders(english.get(key)!))
      expect(english.get(key)!.trim()).not.toBe('')
    }
  })

  it('interpolates every declared placeholder', () => {
    expect(lookup(zhCN, 'overlay.limit', { size: '100 MB' })).toBe('单个文件上限 100 MB')
    expect(lookup(en, 'popup.jobReceiving', { count: 3 })).toBe('Receiving · 3 file(s)')
    expect(lookup(zhCN, 'nope.missing')).toBeUndefined()
  })
})

/** Every literal passed to `t()` inside the balanced argument list, ternaries included. */
function usedKeys(text: string): string[] {
  const keys: string[] = []
  for (const call of text.matchAll(/\bt\(/g)) {
    let depth = 0
    let index = call.index! + call[0].length - 1
    for (; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      else if (text[index] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    for (const literal of text.slice(call.index!, index).matchAll(/'(app|popup|overlay|upload|error)\.[A-Za-z.]+'/g)) keys.push(literal[0].slice(1, -1))
  }
  return keys
}

describe('static markup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fills text, placeholders and titles from data attributes', () => {
    const text = [{ dataset: { i18n: 'popup.chooseFile' }, textContent: '' }]
    const placeholder = [{ dataset: { i18nPlaceholder: 'upload.title' }, placeholder: '' }]
    const title = [{ dataset: { i18nTitle: 'popup.edit' }, title: '' }]
    const label = [{ dataset: { i18nAriaLabel: 'popup.showToken' }, attributes: {} as Record<string, string>, setAttribute(name: string, value: string) { this.attributes[name] = value } }]
    const root = {
      querySelectorAll: (selector: string) => (selector === '[data-i18n]' ? text : selector === '[data-i18n-placeholder]' ? placeholder : selector === '[data-i18n-title]' ? title : label),
    }
    vi.stubGlobal('document', { documentElement: { lang: '' } })
    localizeDocument(root as unknown as ParentNode)
    expect(text[0]!.textContent).toBe(zh.get('popup.chooseFile'))
    expect(placeholder[0]!.placeholder).toBe(zh.get('upload.title'))
    expect(title[0]!.title).toBe(zh.get('popup.edit'))
    expect(label[0]!.attributes['aria-label']).toBe(zh.get('popup.showToken'))
    expect((document.documentElement as { lang: string }).lang).toBe('zh-CN')
  })
})

describe('usage', () => {
  it('only references keys that exist in both tables', () => {
    const used = new Set<string>()
    for (const file of readdirSync(root).filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))) {
      for (const key of usedKeys(readFileSync(path.join(root, file), 'utf8'))) used.add(key)
    }
    const pages = path.join(root, '..', 'pages')
    for (const file of readdirSync(pages)) {
      const html = readFileSync(path.join(pages, file), 'utf8')
      for (const match of html.matchAll(/data-i18n(?:-placeholder|-title)?="((?:app|popup|overlay|upload|error)\.[A-Za-z.]+)"/g)) used.add(match[1]!)
    }
    expect(used.size).toBeGreaterThan(50)
    for (const key of used) {
      expect({ key, zh: zh.has(key), en: english.has(key) }).toEqual({ key, zh: true, en: true })
    }
  })
})
