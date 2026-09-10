import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TocRuleRes } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import TocRuleEditor from '../features/settings/components/TocRuleEditor'

const updateMutate = vi.fn()
const createMutate = vi.fn()

vi.mock('@/api/hooks/useTocRules', () => ({
  useCreateTocRule: () => ({ mutate: createMutate, isPending: false }),
  useUpdateTocRule: () => ({ mutate: updateMutate, isPending: false }),
}))

const initial: TocRuleRes = {
  id: 'rule-1',
  name: '中文规则',
  enabled: true,
  sortOrder: 0,
  patterns: [
    { level: 1, regex: '^卷', replacement: null, enabled: true },
    { level: 2, regex: '^章', replacement: '$1', enabled: false },
  ],
  builtIn: false,
  createdAt: 1,
  updatedAt: 1,
}

describe('TocRuleEditor', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
  })

  it('uses card order as the level and submits normalized levels', () => {
    render(<TocRuleEditor initial={initial} onClose={vi.fn()} />)

    expect(screen.getByText('目录层级')).toBeInTheDocument()
    expect(screen.getByText('层级 1')).toBeInTheDocument()
    expect(screen.getByText('层级 2')).toBeInTheDocument()
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '添加层级' }))
    expect(screen.getByText('层级 3')).toBeInTheDocument()
    fireEvent.change(screen.getAllByRole('textbox')[5]!, { target: { value: '^节' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'rule-1',
      body: {
        name: '中文规则',
        enabled: true,
        patterns: [
          { level: 1, regex: '^卷', replacement: null, enabled: true },
          { level: 2, regex: '^章', replacement: '$1', enabled: false },
          { level: 3, regex: '^节', replacement: null, enabled: true },
        ],
      },
    }, expect.anything())
  })

  it('keeps the rule name field empty and validates it only on submit', () => {
    render(<TocRuleEditor onClose={vi.fn()} />)

    expect(screen.queryByPlaceholderText('例如：起点网文（卷+章）')).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '^章' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByText('规则名称不能为空')).toBeInTheDocument()
    expect(createMutate).not.toHaveBeenCalled()
  })
})
