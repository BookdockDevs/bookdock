import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TocRuleRes } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import ContentRechapterModal from '../features/content-editor/components/ContentRechapterModal'

const createRuleMutate = vi.fn()
const updateRuleMutate = vi.fn()

vi.mock('@/api/hooks/useTocRules', () => ({
  useCreateTocRule: () => ({ mutate: createRuleMutate, isPending: false }),
  useUpdateTocRule: () => ({ mutate: updateRuleMutate, isPending: false }),
}))

const sampleRules: TocRuleRes[] = [
  {
    id: 'rule-1',
    name: '默认章节规则',
    patterns: [{ level: 1, regex: '^第.+章', replacement: '$1', enabled: true }],
    enabled: true,
    builtIn: false,
    mine: true,
    availability: 'user',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  },
]

describe('ContentRechapterModal rule editor', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    createRuleMutate.mockReset()
    updateRuleMutate.mockReset()
  })

  it('supports creating global or book-only rules, compact template import, and deleting the last level', () => {
    render(
      <ContentRechapterModal
        initialText={'第一章 开始\n正文内容'}
        rules={sampleRules}
        customPatterns={[{ level: 1, regex: '^第.+章', replacement: '$1', enabled: true }]}
        initialRuleId="custom"
        unitCount={1}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // 1. Click "+" to create a rule -> defaults to global rule with name input & compact import
    fireEvent.click(screen.getByRole('button', { name: '新建目录规则' }))
    expect(screen.getByText('新建目录规则')).toBeInTheDocument()
    expect(screen.getAllByText('导入规则').length).toBeGreaterThan(0)
    expect(screen.queryByText('从现有规则复制')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument()

    // Select "仅本书" in scope -> keeps name input in place (no layout shift) and makes it optional
    fireEvent.click(screen.getByRole('button', { name: '仅本书' }))
    expect(screen.getByText('新建目录规则')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '规则名称' })).toBeInTheDocument()

    // Deleting the last level should be allowed
    const removeBtn = screen.getByRole('button', { name: '删除该层级' })
    expect(removeBtn).not.toBeDisabled()
    fireEvent.click(removeBtn)
    expect(screen.getByText('暂无目录层级，可点击「添加层级」或从现有规则复制')).toBeInTheDocument()

    // Close sub-modal
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)

    // 2. Click pencil icon on global rule -> edit global rule without "仅本书" option
    fireEvent.click(screen.getByRole('button', { name: '编辑目录规则' }))
    expect(screen.getByText('编辑目录规则')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '仅本书' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    expect(updateRuleMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rule-1' }),
      expect.anything(),
    )
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)

    // 3. Click pencil icon on custom rule -> unified "编辑目录规则" title
    fireEvent.click(screen.getByRole('button', { name: '编辑专属目录规则' }))
    expect(screen.getByText('编辑目录规则')).toBeInTheDocument()
  })
})
