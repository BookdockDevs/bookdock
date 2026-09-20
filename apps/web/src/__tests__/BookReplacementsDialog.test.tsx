import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useBookReplacements, useDeleteReplacement } from '@/api/hooks/useReplacements'
import i18n from '../i18n/i18n'
import BookReplacementsDialog from '../features/reader/components/BookReplacementsDialog'
import { useReaderApi } from '../features/reader/hooks/useReaderApi'
import { useReaderState } from '../features/reader/state/reader-state'

vi.mock('@/api/hooks/useReplacements', () => ({
  useReplacements: vi.fn(() => ({ data: { data: [] } })),
  useBookReplacements: vi.fn(() => ({ data: { data: [] } })),
  useCreateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteReplacement: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSetReplacementOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../features/reader/hooks/useReaderApi', () => ({
  useReaderApi: vi.fn(() => ({ renderer: null })),
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
  vi.mocked(useBookReplacements).mockReturnValue({ data: { data: list } } as ReturnType<typeof useBookReplacements>)
}

describe('BookReplacementsDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useBookReplacements>)
    vi.mocked(useDeleteReplacement).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteReplacement>)
    vi.mocked(useReaderApi).mockReturnValue({ renderer: null })
  })

  it('carries data-settings-toggle so the portaled dialog never closes the settings popover', () => {
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    // The backdrop is the dialog root; SettingsPopover's capture-phase close
    // handler ignores clicks inside [data-settings-toggle]. The dialog portals
    // to body, so it isn't under the render container.
    const root = document.body.querySelector('[data-settings-toggle]')
    expect(root).not.toBeNull()
    expect(root).toHaveClass('fixed', 'inset-0')
  })

  it('renders the per-book section and merged point patches', () => {
    vi.mocked(useBookReplacements).mockReturnValue({
      data: { data: [{ id: 'p1', bookId: 'b1', scope: 'book', matchType: 'point', pattern: null, replacement: '好', isRegex: false, applyTo: 'content', enabled: true, name: null, group: null, spineHref: 'c1', textOffset: 1, originalText: '坏', createdAt: 0, updatedAt: 0 }] },
    } as ReturnType<typeof useBookReplacements>)
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    expect(screen.getByText('文本替换')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('坏 → 好'))).toBeInTheDocument()
    // no section headers in the merged list
    expect(screen.queryByText('定点补丁')).not.toBeInTheDocument()
  })

  it('closing the edit form returns to the rules list instead of closing the dialog', () => {
    mockRules([rule({ id: 't1', name: '去广告' })])
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByText('编辑文本替换规则')).toBeInTheDocument()
    expect(screen.getByText('保存')).toBeInTheDocument()

    // The header X cancels the edit (back semantics) and shows the list again
    const closeBtn = screen.getAllByRole('button', { name: '取消' }).find((b) => !b.textContent)
    fireEvent.click(closeBtn!)
    expect(screen.queryByText('保存')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('deletes a point patch from the reader settings dialog', () => {
    const deleteReplacement = { mutate: vi.fn(), isPending: false }
    vi.mocked(useDeleteReplacement).mockReturnValue(deleteReplacement as unknown as ReturnType<typeof useDeleteReplacement>)
    mockRules([rule({ id: 'p1', bookId: 'b1', scope: 'book', matchType: 'point', pattern: null, originalText: '错字', replacement: '对字', spineHref: 'c1', textOffset: 1 })])
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText(/确定要删除文本替换规则/)).toBeInTheDocument()
    const confirmButton = screen.getAllByRole('button', { name: '删除' }).find((button) => button.textContent === '删除')
    fireEvent.click(confirmButton!)

    expect(deleteReplacement.mutate).toHaveBeenCalledWith('p1', expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('displays effective rules count in title capsule and excludes disabled rules', () => {
    mockRules([
      rule({ id: 't1', enabled: true, effectiveEnabled: true }),
      rule({ id: 't2', enabled: true, effectiveEnabled: false }), // disabled for this book
      rule({ id: 'p1', matchType: 'point', spineHref: 'c1', originalText: '错字', replacement: '对字', enabled: true }),
    ])
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    // Only t1 and p1 are effective, t2 is disabled for this book -> count should be 2
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('omits count capsule when no rules are effective', () => {
    mockRules([
      rule({ id: 't1', enabled: true, effectiveEnabled: false }),
    ])
    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)

    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('jumps to a point patch position instead of only its chapter', () => {
    const display = vi.fn()
    vi.mocked(useReaderApi).mockReturnValue({ renderer: { display } } as unknown as ReturnType<typeof useReaderApi>)
    useReaderState.setState({ tocItems: [{ label: '第一章', href: 'c1' }] })
    mockRules([rule({ id: 'p1', bookId: 'b1', matchType: 'point', spineHref: 'c1', textOffset: 12, originalText: '旧文', replacement: '新文' })])

    render(<BookReplacementsDialog bookId="b1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '第一章' }))

    expect(display).toHaveBeenCalledWith('replacement-hit:c1:12:%E6%96%B0%E6%96%87')
  })
})
