import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useCreateReplacement, useDeleteGlobalReplacements, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import i18n from '../i18n/i18n'
import ReplacementsSettingsSection from '../features/settings/components/ReplacementsSettingsSection'

vi.mock('@/api/hooks/useReplacements', () => ({
  useReplacements: vi.fn(() => ({ data: { data: [] } })),
  useCreateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteGlobalReplacements: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useImportReplacements: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const rule = (overrides: Partial<TextReplacementRes> = {}): TextReplacementRes => ({
  id: 't1',
  bookId: null,
  scope: 'global',
  matchType: 'pattern',
  pattern: '广告词',
  replacement: null,
  isRegex: false,
  applyTo: 'content',
  enabled: true,
  name: null,
  group: null,
  spineHref: null,
  textOffset: null,
  originalText: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const mockRules = (list: TextReplacementRes[]) => {
  vi.mocked(useReplacements).mockReturnValue({ data: { data: list } } as ReturnType<typeof useReplacements>)
}

describe('ReplacementsSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockRules([])
  })

  it('shows the empty hint when there are no rules', () => {
    render(<ReplacementsSettingsSection />)

    expect(screen.getByText(/还没有替换规则/)).toBeInTheDocument()
    expect(screen.queryByText('· 0')).not.toBeInTheDocument()
  })

  it('shows only global pattern rules in execution order with group badges', () => {
    mockRules([
      rule({ id: 't1', name: '广告组规则', group: 'a组', sortOrder: 0, createdAt: 100 }),
      rule({ id: 't2', name: '无组规则', sortOrder: 1, createdAt: 200 }),
      rule({ id: 't3', name: 'B组', group: 'b组', sortOrder: 2, createdAt: 300 }),
      // book-scoped rules and point patches are managed in the reader dialog
      rule({ id: 't4', pattern: 'book rule', bookId: 'bX', scope: 'book', sortOrder: 3, createdAt: 400 }),
      rule({ id: 't5', pattern: null, matchType: 'point', originalText: '错字', bookId: 'bX', scope: 'book', sortOrder: 4, createdAt: 500 }),
    ])
    render(<ReplacementsSettingsSection />)

    // group renders as a badge, never as a re-sorting section header
    expect(screen.getByText('a组')).toBeInTheDocument()
    expect(screen.getByText('b组')).toBeInTheDocument()
    expect(screen.getByText('无组规则')).toBeInTheDocument()
    expect(screen.queryByText('未分组')).not.toBeInTheDocument()
    expect(screen.queryByText('book rule')).not.toBeInTheDocument()
    expect(screen.queryByText('错字')).not.toBeInTheDocument()
    expect(screen.getByText('· 3')).toBeInTheDocument()
    // execution order, not newest-first: position 1 is the oldest rule
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('广告组规则')
    expect(items[1]).toHaveTextContent('无组规则')
    expect(items[2]).toHaveTextContent('B组')
  })

  it('offers import and full export without row exports', () => {
    mockRules([rule({ name: '去广告' })])
    render(<ReplacementsSettingsSection />)

    expect(screen.getByRole('button', { name: '导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出全部规则' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出这条规则' })).not.toBeInTheDocument()
  })

  it('shows edit and delete actions only while editing', () => {
    mockRules([rule({ name: '去广告' })])
    render(<ReplacementsSettingsSection />)

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '退出编辑模式' }))
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('supports select-all and keeps selected rules available after a failed batch deletion', () => {
    const mutation = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteGlobalReplacements).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteGlobalReplacements>)
    mockRules([rule({ id: 'a', name: 'A' }), rule({ id: 'b', name: 'B' })])
    render(<ReplacementsSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 A' }))
    expect(screen.getByRole('checkbox', { name: '全选' })).toBePartiallyChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('确定删除所选的 2 条规则')
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    expect(mutation.mutate).toHaveBeenCalledWith({ ruleIds: ['a', 'b'] }, expect.any(Object))
    act(() => mutation.mutate.mock.calls[0]![1].onError(new Error('failed')))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeChecked()
    act(() => mutation.mutate.mock.calls[0]![1].onSuccess())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出编辑模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled()
  })

  it('exports only the selected global rule with its complete configuration', async () => {
    const createUrl = vi.fn((_blob: Blob) => 'blob:export')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockRules([rule({ id: 'a', name: 'A', sortOrder: 0 }), rule({ id: 'b', name: 'B', sortOrder: 1, isRegex: true, pattern: 'b+', applyTo: 'both', group: 'group', replacement: 'new' })])
    render(<ReplacementsSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 B' }))
    fireEvent.click(screen.getByRole('button', { name: '导出所选' }))
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(createUrl.mock.calls[0]![0])
    })
    const exported = JSON.parse(text)
    expect(exported).toEqual({ kind: 'bookdock.text-replacements', formatVersion: 1, rules: [{ name: 'B', group: 'group', pattern: 'b+', replacement: 'new', isRegex: true, applyTo: 'both', enabled: true }] })
  })

  it('fades disabled rules without a strikethrough', () => {
    mockRules([rule({ name: '停用规则', enabled: false })])
    render(<ReplacementsSettingsSection />)

    const name = screen.getByText('停用规则')
    expect(name).not.toHaveClass('line-through')
    expect(name.closest('li')).toHaveClass('opacity-60')
  })

  it('toggles a rule via the update mutation (global default switch)', () => {
    const updateReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useUpdateReplacement).mockReturnValue(updateReplacement as unknown as ReturnType<typeof useUpdateReplacement>)
    mockRules([rule({ enabled: true })])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('switch', { name: '启用' }))
    expect(updateReplacement.mutate).toHaveBeenCalledWith(
      { id: 't1', body: { enabled: false } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('deletes a rule through the styled confirm dialog', () => {
    const deleteReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteGlobalReplacements).mockReturnValue(deleteReplacement as unknown as ReturnType<typeof useDeleteGlobalReplacements>)
    mockRules([rule()])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(screen.getByText(/确定删除所选的 1 条规则/)).toBeInTheDocument()
    const confirmBtn = screen.getAllByRole('button', { name: '删除' }).find((b) => b.textContent === '删除')
    fireEvent.click(confirmBtn!)
    expect(deleteReplacement.mutate).toHaveBeenCalledWith({ ruleIds: ['t1'] }, expect.objectContaining({ onError: expect.any(Function) }))
  })

  it('creates a rule in the shared modal and cancels back to the list', () => {
    const createReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useCreateReplacement).mockReturnValue(createReplacement as unknown as ReturnType<typeof useCreateReplacement>)
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '新建文本替换规则' }))
    expect(screen.getByText('新建文本替换规则')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '新规则' } })
    fireEvent.click(screen.getByText('保存'))
    const [body] = createReplacement.mutate.mock.calls[0]
    expect(body).toMatchObject({ matchType: 'pattern', pattern: '新规则' })
    expect(body).not.toHaveProperty('bookId')

    // the mocked mutation never fires onSuccess — cancel closes the modal
    fireEvent.click(screen.getByText('取消'))
    expect(screen.getByText(/还没有替换规则/)).toBeInTheDocument()
  })

  it('blocks an invalid regex inline', () => {
    const createReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useCreateReplacement).mockReturnValue(createReplacement as unknown as ReturnType<typeof useCreateReplacement>)
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '新建文本替换规则' }))
    fireEvent.change(screen.getByLabelText(/匹配内容/), { target: { value: '([' } })
    fireEvent.click(screen.getByRole('switch', { name: '正则表达式' }))
    fireEvent.click(screen.getByText('保存'))
    expect(screen.getByText(/正则表达式无效/)).toBeInTheDocument()
    expect(createReplacement.mutate).not.toHaveBeenCalled()
  })

  it('edits an existing rule in the shared modal', () => {
    const updateReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useUpdateReplacement).mockReturnValue(updateReplacement as unknown as ReturnType<typeof useUpdateReplacement>)
    mockRules([rule({ name: '去广告', replacement: '' })])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByText('编辑文本替换规则')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/替换为/), { target: { value: '**' } })
    fireEvent.click(screen.getByText('保存'))
    expect(updateReplacement.mutate).toHaveBeenCalledWith(
      { id: 't1', body: expect.objectContaining({ pattern: '广告词', replacement: '**', name: '去广告' }) },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('hides the scope segment in the settings form (global-only context)', () => {
    mockRules([rule({ pattern: 'foo' })])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.queryByRole('button', { name: '仅此一处' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '本书所有匹配处' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '所有匹配处' })).not.toBeInTheDocument()
  })

  it('keeps the group field editable per rule without group sections', () => {
    mockRules([rule({ id: 'r1', name: '规则1', group: '旧分组' })])
    render(<ReplacementsSettingsSection />)

    // no group headers, no bulk group actions — the badge is display-only
    expect(screen.getByText('旧分组')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重命名分组' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除分组' })).not.toBeInTheDocument()
  })
})
