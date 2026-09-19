import { describe, expect, it } from 'vitest'

import { formatImageFileName } from '../image-actions'
import type { ImageMediaInfo } from '../../types'

describe('formatImageFileName', () => {
  it('formats cover filename with book title', () => {
    const cover: ImageMediaInfo = {
      sectionIndex: 0,
      cfi: 'epubcfi(/6/2)',
      src: 'blob:http://localhost/123',
      alt: '',
      title: 'cover',
      kind: 'image',
    }
    expect(formatImageFileName(cover, '星海漫游', 'jpeg')).toBe('星海漫游_封面.jpeg')
  })

  it('formats illustration filename with book title and alt label', () => {
    const illustration: ImageMediaInfo = {
      sectionIndex: 3,
      cfi: 'epubcfi(/6/8)',
      src: 'blob:http://localhost/456',
      alt: '地理舆图',
      title: '',
      kind: 'image',
    }
    expect(formatImageFileName(illustration, '星海漫游', 'png')).toBe('星海漫游_地理舆图.png')
  })

  it('formats unnamed illustration filename with section index fallback', () => {
    const illustration: ImageMediaInfo = {
      sectionIndex: 4,
      cfi: 'epubcfi(/6/10)',
      src: 'blob:http://localhost/789',
      alt: '',
      title: '',
      kind: 'image',
    }
    expect(formatImageFileName(illustration, '星海漫游', 'webp')).toBe('星海漫游_插图_5.webp')
  })

  it('sanitizes illegal filename characters and extra whitespace', () => {
    const illustration: ImageMediaInfo = {
      sectionIndex: 2,
      cfi: 'epubcfi(/6/6)',
      src: 'blob:http://localhost/abc',
      alt: '人物图/关系表:v1*?',
      title: '',
      kind: 'image',
    }
    expect(formatImageFileName(illustration, 'Book: Vol 1 / Special', 'jpg')).toBe('Book_Vol_1_Special_人物图关系表v1.jpg')
  })
})
