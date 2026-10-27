import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TocRuleRes } from '@bookdock/shared'

import i18n from '@/i18n/i18n'
import { decodeEditorTxtFile } from '../hooks/useEditorContent'
import ContentToolDialog from './ContentToolDialog'

vi.mock('../hooks/useEditorContent', () => ({ decodeEditorTxtFile: vi.fn() }))

const rule: TocRuleRes = {
  id: 'chapter-rule',
  name: '章节标题',
  enabled: true,
  sortOrder: 1,
  patterns: [{ level: 1, regex: '^第.+章$', replacement: null, enabled: true }],
  builtIn: false,
  createdAt: 1,
  updatedAt: 1,
}

describe('ContentToolDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('chooses the matching rule, predicts continuation, and applies the selected import range to the draft', () => {
    const onApply = vi.fn()
    render(<ContentToolDialog
      mode="add"
      bookId="book-1"
      initialText={`第一章\n\n${'已有正文。'.repeat(250)}\n\n第二章\n\n${'续写正文。'.repeat(250)}\n\n第三章\n\n续写`}
      rules={[rule]}
      existingUnits={[{ id: 'one', title: '第一章', content: '已有', level: 0 }]}
      unitCount={1}
      defaultInsertIndex={0}
      onApply={onApply}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('即时预览')).toBeInTheDocument()
    expect(screen.getByText('已跳过前 1 章历史内容')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入到草稿' }))

    const [units, insertIndex, selection] = onApply.mock.calls[0]!
    expect(units.map((unit) => unit.title)).toEqual(['第二章', '第三章'])
    expect(units[0]?.content).toContain('续写正文。')
    expect(units[1]?.content).toBe('续写')
    expect(insertIndex).toBe(1)
    expect(selection).toEqual({ ruleId: 'chapter-rule', patterns: rule.patterns, label: '章节标题', auto: true })
  })

  it('validates and applies book-specific directory rules with canonical levels', () => {
    const onApply = vi.fn()
    render(<ContentToolDialog
      mode="rechapter"
      bookId="book-1"
      initialText={'第一节\n\n内容'}
      rules={[]}
      existingUnits={[]}
      unitCount={0}
      defaultInsertIndex={0}
      onApply={onApply}
      onClose={vi.fn()}
    />)

    fireEvent.click(screen.getByLabelText('新建专属规则'))
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    expect(screen.getByRole('alert')).toHaveTextContent('至少添加一个目录层级')
    fireEvent.click(screen.getByRole('button', { name: '添加层级' }))
    fireEvent.change(screen.getByRole('textbox', { name: '第1层正则表达式' }), { target: { value: '[' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    expect(screen.queryByText('至少添加一个目录层级')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '第1层正则表达式' }), { target: { value: '^第一节$' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    fireEvent.click(screen.getByRole('button', { name: '应用到草稿' }))

    expect(onApply).toHaveBeenCalledWith(
      [{ id: expect.any(String), title: '第一节', content: '内容', level: 1 }],
      0,
      { ruleId: 'custom', patterns: [{ level: 1, regex: '^第一节$', replacement: null, enabled: true }], label: '本书专属规则', auto: false },
    )
  })

  it('decodes imported files through the existing server text detector', async () => {
    vi.mocked(decodeEditorTxtFile).mockResolvedValueOnce({ data: { text: '第一章\n\n已识别正文' } })
    render(<ContentToolDialog
      mode="add"
      bookId="book-1"
      initialText=""
      rules={[]}
      existingUnits={[]}
      unitCount={0}
      defaultInsertIndex={0}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />)
    const file = new File(['ignored client bytes'], 'import.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('选择 TXT 文件'), { target: { files: [file] } })

    expect(await screen.findByRole('textbox', { name: '粘贴文本' })).toHaveValue('第一章\n\n已识别正文')
    expect(decodeEditorTxtFile).toHaveBeenCalledWith('book-1', file)
  })

  it('reports an unreadable encoding instead of silently importing corrupted text', async () => {
    vi.mocked(decodeEditorTxtFile).mockRejectedValueOnce(new Error('server unavailable'))
    render(<ContentToolDialog mode="add" bookId="book-1" initialText="" rules={[]} existingUnits={[]} unitCount={0} defaultInsertIndex={0} onApply={vi.fn()} onClose={vi.fn()} />)
    const file = new File(['bytes'], 'import.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer })
    fireEvent.change(screen.getByLabelText('选择 TXT 文件'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取文件或识别编码')
    expect(screen.getByRole('button', { name: '导入到草稿' })).toBeDisabled()
  })
})
