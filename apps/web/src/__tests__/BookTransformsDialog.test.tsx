import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TextTransformRes } from '@bookdock/shared'

import { useBookTransforms } from '@/api/hooks/useTransforms'
import i18n from '../i18n/i18n'
import BookTransformsDialog from '../features/reader/components/BookTransformsDialog'
import { useReaderApi } from '../features/reader/hooks/useReaderApi'

vi.mock('@/api/hooks/useTransforms', () => ({
  useBookTransforms: vi.fn(() => ({ data: { data: [] } })),
  useCreateTransform: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTransform: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteTransform: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSetTransformOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../features/reader/hooks/useReaderApi', () => ({
  useReaderApi: vi.fn(() => ({ renderer: null })),
}))

const rule = (overrides: Partial<TextTransformRes> = {}): TextTransformRes => ({
  id: 't1',
  bookId: null,
  scope: 'global',
  matchType: 'pattern',
  pattern: '广告词',
  replacement: null,
  isRegex: false,
  caseSensitive: true,
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

const mockRules = (list: TextTransformRes[]) => {
  vi.mocked(useBookTransforms).mockReturnValue({ data: { data: list } } as ReturnType<typeof useBookTransforms>)
}

describe('BookTransformsDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.mocked(useBookTransforms).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useBookTransforms>)
    vi.mocked(useReaderApi).mockReturnValue({ renderer: null })
  })

  it('carries data-settings-toggle so the portaled dialog never closes the settings popover', () => {
    const { container } = render(<BookTransformsDialog bookId="b1" onClose={() => {}} />)

    // The backdrop is the dialog root; SettingsPopover's capture-phase close
    // handler ignores clicks inside [data-settings-toggle]
    const root = container.querySelector('[data-settings-toggle]')
    expect(root).not.toBeNull()
    expect(root).toHaveClass('fixed', 'inset-0')
  })

  it('renders the per-book section and merged point patches', () => {
    vi.mocked(useBookTransforms).mockReturnValue({
      data: { data: [{ id: 'p1', bookId: 'b1', scope: 'book', matchType: 'point', pattern: null, replacement: '好', isRegex: false, caseSensitive: true, enabled: true, name: null, group: null, spineHref: 'c1', textOffset: 1, originalText: '坏', createdAt: 0, updatedAt: 0 }] },
    } as ReturnType<typeof useBookTransforms>)
    render(<BookTransformsDialog bookId="b1" onClose={() => {}} />)

    expect(screen.getByText('正文变换')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('坏 → 好'))).toBeInTheDocument()
    // no section headers in the merged list
    expect(screen.queryByText('定点补丁')).not.toBeInTheDocument()
  })

  it('closing the edit form returns to the rules list instead of closing the dialog', () => {
    mockRules([rule({ id: 't1', name: '去广告' })])
    render(<BookTransformsDialog bookId="b1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByText('编辑规则')).toBeInTheDocument()
    expect(screen.getByText('保存')).toBeInTheDocument()

    // The header X cancels the edit (back semantics) and shows the list again
    const closeBtn = screen.getAllByRole('button', { name: '取消' }).find((b) => !b.textContent)
    fireEvent.click(closeBtn!)
    expect(screen.queryByText('保存')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })
})
