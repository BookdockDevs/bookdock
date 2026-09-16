import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useCreateReplacement, useDeleteReplacement, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import i18n from '../i18n/i18n'
import ReplacementsSettingsSection from '../features/settings/components/ReplacementsSettingsSection'

vi.mock('@/api/hooks/useReplacements', () => ({
  useReplacements: vi.fn(() => ({ data: { data: [] } })),
  useCreateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

  it('shows only global pattern rules with ungrouped rules at the top level', () => {
    mockRules([
      rule({ id: 't1', name: '广告组规则', group: 'a组', createdAt: 100 }),
      rule({ id: 't2', name: '无组规则', createdAt: 200 }),
      rule({ id: 't3', name: 'B组', group: 'b组', createdAt: 300 }),
      // book-scoped rules and point patches are managed in the reader dialog
      rule({ id: 't4', pattern: 'book rule', bookId: 'bX', scope: 'book', createdAt: 400 }),
      rule({ id: 't5', pattern: null, matchType: 'point', originalText: '错字', bookId: 'bX', scope: 'book', createdAt: 500 }),
    ])
    render(<ReplacementsSettingsSection />)

    expect(screen.getByText('a组')).toBeInTheDocument()
    expect(screen.getByText('b组')).toBeInTheDocument()
    expect(screen.getByText('无组规则')).toBeInTheDocument()
    expect(screen.queryByText('未分组')).not.toBeInTheDocument()
    expect(screen.queryByText('book rule')).not.toBeInTheDocument()
    expect(screen.queryByText('错字')).not.toBeInTheDocument()
    expect(screen.getByText('· 3')).toBeInTheDocument()
    // named groups sort alphabetically; ungrouped rules have no group header
    const headers = screen.getAllByRole('button', { expanded: true })
    const names = headers.map((h) => h.textContent)
    expect(names[0]).toContain('a组')
    expect(names[1]).toContain('b组')
    expect(names).toHaveLength(2)
  })

  it('collapses and expands a group', () => {
    mockRules([
      rule({ id: 't1', name: 'A规则', group: '广告' }),
      rule({ id: 't2', name: 'B规则' }),
    ])
    render(<ReplacementsSettingsSection />)

    expect(screen.getByText('A规则')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /广告/ }))
    expect(screen.queryByText('A规则')).not.toBeInTheDocument()
    expect(screen.getByText('B规则')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /广告/ }))
    expect(screen.getByText('A规则')).toBeInTheDocument()
  })

  it('shows edit and delete actions only while editing', () => {
    mockRules([rule({ name: '去广告' })])
    render(<ReplacementsSettingsSection />)

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '退出编辑模式' }))
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
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
    vi.mocked(useDeleteReplacement).mockReturnValue(deleteReplacement as unknown as ReturnType<typeof useDeleteReplacement>)
    mockRules([rule()])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText(/确定要删除文本替换规则/)).toBeInTheDocument()
    const confirmBtn = screen.getAllByRole('button', { name: '删除' }).find((b) => b.textContent === '删除')
    fireEvent.click(confirmBtn!)
    expect(deleteReplacement.mutate).toHaveBeenCalledWith('t1', expect.objectContaining({ onError: expect.any(Function) }))
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

  it('renames a group across all its member rules', async () => {
    const updateReplacement = { mutate: vi.fn((_, opts) => opts?.onSuccess?.()), isPending: false }
    vi.mocked(useUpdateReplacement).mockReturnValue(updateReplacement as unknown as ReturnType<typeof useUpdateReplacement>)
    mockRules([
      rule({ id: 'r1', name: '规则1', group: '旧分组' }),
      rule({ id: 'r2', name: '规则2', group: '旧分组' }),
    ])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '重命名分组' }))
    expect(screen.getByText('重命名分组')).toBeInTheDocument()

    const input = screen.getByDisplayValue('旧分组')
    fireEvent.change(input, { target: { value: '新分组' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(updateReplacement.mutate).toHaveBeenCalledWith(
      { id: 'r1', body: { group: '新分组' } },
      expect.any(Object),
    )
    expect(updateReplacement.mutate).toHaveBeenCalledWith(
      { id: 'r2', body: { group: '新分组' } },
      expect.any(Object),
    )
  })

  it('disbands a group by moving rules to ungrouped when delete checkbox is unchecked', async () => {
    const updateReplacement = { mutate: vi.fn((_, opts) => opts?.onSuccess?.()), isPending: false }
    vi.mocked(useUpdateReplacement).mockReturnValue(updateReplacement as unknown as ReturnType<typeof useUpdateReplacement>)
    mockRules([rule({ id: 'r1', name: '规则1', group: '广告组' })])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }))
    expect(screen.getByText('删除分组')).toBeInTheDocument()
    expect(screen.getByText(/未勾选时，分组下的规则将移至未分组/)).toBeInTheDocument()

    // Confirm delete without checking checkbox -> ungroups rules
    const confirmBtn1 = screen.getAllByRole('button', { name: '删除' }).find((b) => b.textContent === '删除')
    await act(async () => {
      fireEvent.click(confirmBtn1!)
    })
    expect(updateReplacement.mutate).toHaveBeenCalledWith(
      { id: 'r1', body: { group: null } },
      expect.any(Object),
    )
  })

  it('permanently deletes all rules in a group when checkbox is checked', async () => {
    const deleteReplacement = { mutate: vi.fn((_, opts) => opts?.onSuccess?.()), isPending: false }
    vi.mocked(useDeleteReplacement).mockReturnValue(deleteReplacement as unknown as ReturnType<typeof useDeleteReplacement>)
    mockRules([
      rule({ id: 'r1', name: '规则1', group: '广告组' }),
      rule({ id: 'r2', name: '规则2', group: '广告组' }),
    ])
    render(<ReplacementsSettingsSection />)

    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }))
    expect(screen.getByText('删除分组')).toBeInTheDocument()

    // Check checkbox -> cascade delete
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/勾选后，分组下的所有规则将被永久删除/)).toBeInTheDocument()

    const confirmBtn2 = screen.getAllByRole('button', { name: '删除' }).find((b) => b.textContent === '删除')
    await act(async () => {
      fireEvent.click(confirmBtn2!)
    })
    expect(deleteReplacement.mutate).toHaveBeenCalledWith('r1', expect.any(Object))
    expect(deleteReplacement.mutate).toHaveBeenCalledWith('r2', expect.any(Object))
  })
})
