import { describe, expect, it } from 'vitest'

import type { AnnotationRes } from '@bookdock/shared'

import { buildAnnotationCsv, buildAnnotationMarkdown, buildAnnotationText } from '../annotation-export'

const book = { id: 'book-1', title: '测试之书', author: '作者' }
const annotation: AnnotationRes = {
  id: 'note-1',
  bookId: 'book-1',
  cfiRange: 'epubcfi(/6/2!/4/2)',
  cfiAnchor: null,
  type: 'note',
  color: 'blue',
  style: 'highlight',
  text: '摘录\n第二行',
  note: '我的想法',
  chapter: '第一章',
  createdAt: 1000,
  updatedAt: 2000,
}

const highlight: AnnotationRes = {
  ...annotation,
  id: 'highlight-1',
  type: 'highlight',
  color: 'yellow',
  style: 'underline',
  note: null,
  text: '一条普通划线',
}

const bookmark: AnnotationRes = {
  ...annotation,
  id: 'bookmark-1',
  type: 'bookmark',
  color: 'yellow',
  style: 'underline',
  note: null,
  text: '第二章：未完成的告白',
}

const labels = {
  author: '作者',
  bookmark: '书签',
  highlight: '划线',
  idea: '想法',
  unnamedBookmark: '未命名书签',
  separator: '：',
  recordedAt: '记录时间',
  openInBook: '在 Bookdock 中打开',
  color: (color: string) => color,
  style: (style: string) => style,
}

describe('annotation export', () => {
  it('builds readable markdown with optional metadata and a deep link', () => {
    const output = buildAnnotationMarkdown([annotation], book, { includeDetails: true, includeTime: false, includeDeepLink: true }, labels)
    expect(output).toContain('# 测试之书')
    expect(output).toContain('> 摘录\n> 第二行')
    expect(output).toContain('**想法**：我的想法')
    expect(output).toContain('*想法 · blue · highlight*')
    expect(output).toContain('[在 Bookdock 中打开](http://localhost:3000/books/book-1?annotation=note-1&cfi=epubcfi%28%2F6%2F2%21%2F4%2F2%29)')
    expect(output).not.toContain('记录于')
    expect(output).not.toContain('——《测试之书》')
  })

  it('builds plain text without markdown syntax', () => {
    const output = buildAnnotationText([annotation], book, { includeDetails: false, includeTime: true, includeDeepLink: false }, labels)
    expect(output).toContain('摘录\n第二行')
    expect(output).toContain('想法：我的想法')
    expect(output).toContain('记录时间：')
    expect(output).not.toContain('> 摘录')
  })

  it('keeps structured fields and escapes CSV cells', () => {
    const output = buildAnnotationCsv([annotation], book, { includeDetails: true, includeTime: true, includeDeepLink: false })
    expect(output).toContain('Book,Author,Chapter,Text,Note,Type,Color,Style')
    expect(output).toContain('"摘录\n第二行"')
    expect(output).toContain('idea,blue,highlight')
    expect(output).toContain('Created At,Updated At')
  })

  it('uses the user-facing annotation terminology for optional details', () => {
    const output = buildAnnotationMarkdown(
      [highlight, bookmark],
      book,
      { includeDetails: true, includeTime: false, includeDeepLink: false },
      labels,
    )
    expect(output).toContain('*划线 · yellow · underline*')
    expect(output).toContain('- **书签**：第二章：未完成的告白')
    expect(output).not.toContain('*高亮 ·')
  })
})
