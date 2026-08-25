import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { TextTransformRes } from '@bookdock/shared'

import { useBookTransforms, useSetTransformOverride, useUpdateTransform } from '@/api/hooks/useTransforms'
import i18n from '../i18n/i18n'
import BookTransformsSection from '../features/library/components/BookTransformsSection'
import { nextOverrideValue } from '../features/library/transform-overrides'

vi.mock('@/api/hooks/useTransforms', () => ({
  useBookTransforms: vi.fn(() => ({ data: { data: [] } })),
  useSetTransformOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTransform: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

const point = (overrides: Partial<TextTransformRes> = {}): TextTransformRes => ({
  id: 'p1',
  bookId: 'b1',
  scope: 'book',
  matchType: 'point',
  pattern: null,
  replacement: '测试一处',
  isRegex: false,
  caseSensitive: true,
  enabled: true,
  name: null,
  group: null,
  spineHref: 'ch12.xhtml',
  textOffset: 3,
  originalText: '每天我都是骑着那辆用了五年的雅迪电动车',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const mockRules = (list: TextTransformRes[]) => {
  vi.mocked(useBookTransforms).mockReturnValue({ data: { data: list } } as ReturnType<typeof useBookTransforms>)
}

const mockSetOverride = () => {
  const mutation = { mutate: vi.fn(), isPending: false }
  vi.mocked(useSetTransformOverride).mockReturnValue(mutation as unknown as ReturnType<typeof useSetTransformOverride>)
  return mutation
}

describe('nextOverrideValue', () => {
  it('flips the effective value when there is no override', () => {
    expect(nextOverrideValue(rule({ enabled: true, effectiveEnabled: true, hasOverride: false }))).toBe(false)
    expect(nextOverrideValue(rule({ enabled: false, effectiveEnabled: false, hasOverride: false }))).toBe(true)
  })

  it('returns null when the flip lands back on the global default', () => {
    expect(nextOverrideValue(rule({ enabled: true, effectiveEnabled: false, hasOverride: true }))).toBe(null)
    expect(nextOverrideValue(rule({ enabled: false, effectiveEnabled: true, hasOverride: true }))).toBe(null)
  })

  it('updates the override when the flip diverges from the global default', () => {
    expect(nextOverrideValue(rule({ enabled: true, effectiveEnabled: true, hasOverride: true }))).toBe(false)
    expect(nextOverrideValue(rule({ enabled: false, effectiveEnabled: false, hasOverride: true }))).toBe(true)
  })

  it('falls back to the global default when effectiveEnabled is absent', () => {
    expect(nextOverrideValue(rule({ enabled: true, effectiveEnabled: undefined, hasOverride: false }))).toBe(false)
  })
})

describe('BookTransformsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockRules([])
  })

  it('shows the empty hint when there are no rules', () => {
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getByText(/还没有规则/)).toBeInTheDocument()
  })

  it('lists global rules with follow-global badges', () => {
    mockRules([
      rule({ id: 't1', name: '去广告', effectiveEnabled: true, hasOverride: false }),
      rule({ id: 't2', name: '停用规则', enabled: false, effectiveEnabled: false, hasOverride: false }),
      rule({ id: 't3', matchType: 'point', pattern: null, originalText: '错字', bookId: 'b1' }),
    ])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getByText('去广告')).toBeInTheDocument()
    expect(screen.getByText('全局开')).toBeInTheDocument()
    expect(screen.getByText('全局关')).toBeInTheDocument()
    // Point patches are not listed unless passed via the points prop
    expect(screen.queryByText('错字')).not.toBeInTheDocument()
  })

  it('shows the override badge when a per-book override exists', () => {
    mockRules([rule({ enabled: true, effectiveEnabled: false, hasOverride: true })])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getByText('本书关')).toBeInTheDocument()
  })

  it('toggling without an override sets the flipped effective value', () => {
    const mutation = mockSetOverride()
    mockRules([rule({ enabled: true, effectiveEnabled: true, hasOverride: false })])
    render(<BookTransformsSection bookId="b1" />)

    fireEvent.click(screen.getByRole('switch'))
    expect(mutation.mutate).toHaveBeenCalledWith(
      { transformId: 't1', body: { bookId: 'b1', enabled: false } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('toggling an override back to the global default restores inheritance (null)', () => {
    const mutation = mockSetOverride()
    mockRules([rule({ enabled: true, effectiveEnabled: false, hasOverride: true })])
    render(<BookTransformsSection bookId="b1" />)

    fireEvent.click(screen.getByRole('switch'))
    expect(mutation.mutate).toHaveBeenCalledWith(
      { transformId: 't1', body: { bookId: 'b1', enabled: null } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('toggling an override away from the global default updates the override', () => {
    const mutation = mockSetOverride()
    mockRules([rule({ enabled: true, effectiveEnabled: true, hasOverride: true })])
    render(<BookTransformsSection bookId="b1" />)

    fireEvent.click(screen.getByRole('switch'))
    expect(mutation.mutate).toHaveBeenCalledWith(
      { transformId: 't1', body: { bookId: 'b1', enabled: false } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('lists book-scoped pattern rules with a book-only badge and a direct enabled toggle', () => {
    const updateTransform = { mutate: vi.fn(), isPending: false }
    vi.mocked(useUpdateTransform).mockReturnValue(updateTransform as unknown as ReturnType<typeof useUpdateTransform>)
    mockRules([
      rule({ id: 's1', bookId: 'b1', scope: 'book', name: '本书专属规则', enabled: true, effectiveEnabled: true }),
    ])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getByText('本书专属规则')).toBeInTheDocument()
    expect(screen.getByText('本书规则')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))
    // Book-scoped rules flip their own enabled switch — no override layer
    expect(updateTransform.mutate).toHaveBeenCalledWith(
      { id: 's1', body: { enabled: false } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('keeps book-scoped rules of other books out of the list', () => {
    mockRules([rule({ id: 's2', bookId: 'other', scope: 'book', name: '别书的规则' })])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.queryByText('别书的规则')).not.toBeInTheDocument()
    expect(screen.getByText(/还没有规则/)).toBeInTheDocument()
  })

  it('shows per-rule match counts when provided', () => {
    mockRules([rule({ id: 't1', name: '去广告' }), rule({ id: 't2', name: '改错字' })])
    render(<BookTransformsSection bookId="b1" counts={{ t1: 42, t2: 3 }} />)

    expect(screen.getByText('42 处')).toBeInTheDocument()
    expect(screen.getByText('3 处')).toBeInTheDocument()
    // Rows without a count get no badge
    mockRules([rule({ id: 't3' })])
    const { container } = render(<BookTransformsSection bookId="b1" counts={{ t1: 1 }} />)
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(screen.queryByText('1 处')).not.toBeInTheDocument()
  })

  it('renders edit/delete buttons for pattern rows when callbacks are provided', () => {
    mockRules([rule({ id: 't1', name: '去广告' })])
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(<BookTransformsSection bookId="b1" onEdit={onEdit} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('omits edit/delete buttons without callbacks (book detail view)', () => {
    mockRules([rule({ id: 't1' })])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('merges point patches into the list with a chapter prefix and no point badge', () => {
    mockRules([rule({ id: 't1', name: '去广告' })])
    render(
      <BookTransformsSection
        bookId="b1"
        points={[point()]}
        chapterOf={(href) => (href === 'ch12.xhtml' ? '第 12 章' : null)}
      />,
    )

    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('每天我都是骑着那辆用了五年的雅迪电动车 → 测试一处'))).toBeInTheDocument()
    // the snapshot appears once — no separate title line, no point badge
    expect(screen.getAllByText(/每天我都是骑着那辆/)).toHaveLength(1)
    expect(screen.queryByText('定点补丁')).not.toBeInTheDocument()
  })

  it('marks invalid point patches with a red badge', () => {
    render(
      <BookTransformsSection
        bookId="b1"
        points={[point({ spineHref: 'c1', originalText: '坏', replacement: '好' })]}
        invalidIds={['p1']}
      />,
    )

    expect(screen.getByText('失效')).toBeInTheDocument()
  })

  it('renders an unnamed rule as a single pattern line (no duplicated title)', () => {
    mockRules([rule({ id: 't1', pattern: '那也是我亲侄子', name: null })])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getAllByText((_, el) => el?.tagName === 'P' && el.textContent?.startsWith('那也是我亲侄子'))).toHaveLength(1)
  })

  it('shows the replacement summary for pattern rows', () => {
    mockRules([rule({ id: 't1', pattern: '测试一下啦', replacement: '嘻嘻' })])
    render(<BookTransformsSection bookId="b1" />)

    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('测试一下啦 → 嘻嘻'))).toBeInTheDocument()
  })

  it('shows a null replacement as a bare pattern — no arrow, no delete label', () => {
    mockRules([rule({ id: 't1', pattern: '广告词', replacement: null })])
    render(<BookTransformsSection bookId="b1" />)

    const row = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.startsWith('广告词'))
    expect(row.textContent).toBe('广告词')
  })

  it('shows a null point replacement as a bare snapshot — no arrow', () => {
    render(
      <BookTransformsSection
        bookId="b1"
        points={[point({ spineHref: 'ch12.xhtml', originalText: '我掐灭烟蒂', replacement: null })]}
      />,
    )

    const row = screen.getByText((_, el) => el?.tagName === 'P' && el.textContent?.includes('我掐灭烟蒂'))
    expect(row.textContent).toContain('我掐灭烟蒂')
    expect(row.textContent).not.toContain('→')
  })
})
