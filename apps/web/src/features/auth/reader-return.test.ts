import { beforeEach, describe, expect, it } from 'vitest'

import { clearReaderTarget, pendingReaderTarget, readerTarget, rememberReaderTarget, validatedReaderTarget } from './reader-return'

describe('reader login continuation', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps the book and expected account through a single login', () => {
    rememberReaderTarget('/books/book_123', '?account=user_1&ignored=secret')
    expect(pendingReaderTarget()).toBe('/books/book_123?account=user_1')
    expect(pendingReaderTarget()).toBe('/books/book_123?account=user_1')
    clearReaderTarget()
    expect(pendingReaderTarget()).toBeNull()
  })

  it('does not remember unrelated pages or accept open redirects', () => {
    for (const value of ['https://evil.test', '//evil.test', '/books/../login', '/books/id?account=//evil', '/books/id?account=user&redirect=https://evil', '/books/id#javascript:alert(1)', '/books/%2f%2fevil']) {
      expect(validatedReaderTarget(value)).toBeNull()
    }
    rememberReaderTarget('/settings', '?account=user_1')
    expect(pendingReaderTarget()).toBeNull()
    expect(readerTarget('/books/id', '?account=user_1')).toBe('/books/id?account=user_1')
  })

  it('rejects a tampered stored destination', () => {
    sessionStorage.setItem('bookdock:reader-return', '//evil.test')
    expect(pendingReaderTarget()).toBeNull()
  })
})
