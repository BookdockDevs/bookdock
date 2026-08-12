import { describe, expect, it } from 'vitest'

import {
  clearSearchHistory,
  historyKey,
  loadSearchHistory,
  MAX_SEARCH_HISTORY,
  pushSearchTerm,
  saveSearchHistory,
} from '../features/reader/lib/search-history'

describe('pushSearchTerm', () => {
  it('prepends a new term', () => {
    expect(pushSearchTerm(['甲', '乙'], '丙')).toEqual(['丙', '甲', '乙'])
  })

  it('dedupes and moves an existing term to the front', () => {
    expect(pushSearchTerm(['甲', '乙', '丙'], '乙')).toEqual(['乙', '甲', '丙'])
  })

  it('caps the list at MAX_SEARCH_HISTORY', () => {
    const full = Array.from({ length: MAX_SEARCH_HISTORY }, (_, i) => `词${i}`)
    expect(pushSearchTerm(full, '新词')).toEqual(['新词', ...full.slice(0, MAX_SEARCH_HISTORY - 1)])
  })

  it('keeps the cap when deduping an existing term', () => {
    const full = Array.from({ length: MAX_SEARCH_HISTORY }, (_, i) => `词${i}`)
    expect(pushSearchTerm(full, '词0')).toEqual(['词0', ...full.slice(1)])
  })
})

describe('search history persistence', () => {
  it('round-trips through localStorage under a per-book key', () => {
    saveSearchHistory('book-a', ['甲', '乙'])
    expect(loadSearchHistory('book-a')).toEqual(['甲', '乙'])
    expect(loadSearchHistory('book-b')).toEqual([])
    expect(historyKey('book-a')).toMatch(/^bd-search-history-book-a$/)
  })

  it('clears only the targeted book', () => {
    saveSearchHistory('book-a', ['甲'])
    saveSearchHistory('book-b', ['乙'])
    clearSearchHistory('book-a')
    expect(loadSearchHistory('book-a')).toEqual([])
    expect(loadSearchHistory('book-b')).toEqual(['乙'])
  })

  it('tolerates corrupt JSON and non-string entries', () => {
    localStorage.setItem(historyKey('bad'), 'not json')
    expect(loadSearchHistory('bad')).toEqual([])
    localStorage.setItem(historyKey('mixed'), JSON.stringify(['ok', 42, null, '文']))
    expect(loadSearchHistory('mixed')).toEqual(['ok', '文'])
  })
})
