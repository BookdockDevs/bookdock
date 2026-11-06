import { describe, expect, it } from 'vitest'

import { formatBytes, normalizeInstanceUrl, readerUrl, validateFile } from './model'

describe('connection boundaries', () => {
  it('normalizes root URLs without accepting credentials or other protocols', () => {
    expect(normalizeInstanceUrl(' https://Books.Example.com/ ')).toBe('https://books.example.com')
    expect(normalizeInstanceUrl('http://localhost:18423')).toBe('http://localhost:18423')
    for (const url of ['file:///tmp', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/books', 'https://example.com/?token=secret', 'https://example.com/#secret']) {
      expect(() => normalizeInstanceUrl(url)).toThrow()
    }
  })

  it('validates formats, empty files and instance limits before storing data', () => {
    expect(() => validateFile('book.EPUB', 20, 20)).not.toThrow()
    for (const [name, size] of [['file.pdf', 1], ['book.txt', 0], ['book.epub', 21], ['book.txt', 1.5]] as const) expect(() => validateFile(name, size, 20)).toThrow()
  })

  it('opens only the configured instance with a non-secret account hint', () => {
    expect(readerUrl({ baseUrl: 'https://books.example.com', userId: 'user_1' }, { bookVersionId: 'book_1' })).toBe('https://books.example.com/books/book_1?account=user_1')
    expect(() => readerUrl({ baseUrl: 'https://books.example.com', userId: 'user_1' }, { bookVersionId: '../login?token=secret' })).toThrow()
  })
})

describe('byte formatting', () => {
  it('drops the decimal when it is zero, matching the Web UI', () => {
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB')
    expect(formatBytes(52428800)).toBe('50 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024 ** 3)).toBe('1 GB')
  })
})
