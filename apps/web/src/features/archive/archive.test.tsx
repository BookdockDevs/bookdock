import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { ArchiveOverview, ReadingRange } from '@bookdock/shared'

import i18n from '@/i18n/i18n'

import ArchiveOverviewDashboard from './components/ArchiveOverviewDashboard'
import SortMenu from './components/SortMenu'
import { archiveCountParts, hasReadableText } from './components/archive-helpers'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search, onClick, role }: { children: React.ReactNode; search?: unknown; onClick?: () => void; role?: string }) => (
    <a href="#" role={role} data-search={JSON.stringify(search)} onClick={onClick}>{children}</a>
  ),
}))

vi.mock('@/features/stats/Stats', () => ({
  default: ({ notesSection, query }: { notesSection?: React.ReactNode; query?: ReadingRange }) => (
    <div data-testid="reading-statistics" data-query={JSON.stringify(query)}>{notesSection}</div>
  ),
}))
const mockOverview = vi.fn()
vi.mock('./hooks', () => ({
  useArchiveOverview: (...args: unknown[]) => mockOverview(...args),
  usePreviousArchiveOverview: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

describe('ArchiveOverviewDashboard', () => {
  it('uses the same period, selected-day and all-history scope for notes and reading metrics', () => {
    mockOverview.mockImplementation((query?: ReadingRange) => ({ data: { data: { counts: { highlights: query?.from === query?.to ? 6 : 83, bookmarks: 2, ideas: 7, reviews: 1, total: query?.from === query?.to ? 16 : 93 }, totalBooks: 12 } } }))
    const period = { from: '2026-10-01', to: '2026-10-31', timezone: 'Asia/Shanghai' }
    const { rerender } = render(<ArchiveOverviewDashboard baseSearch={{}} query={period} />)
    expect(screen.getByText('83')).toBeInTheDocument()
    expect(mockOverview).toHaveBeenLastCalledWith(period)
    expect(JSON.parse(screen.getByTestId('reading-statistics').getAttribute('data-query')!)).toEqual(period)

    const day = { ...period, from: '2026-10-18', to: '2026-10-18' }
    rerender(<ArchiveOverviewDashboard baseSearch={{}} query={day} />)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(mockOverview).toHaveBeenLastCalledWith(day)
    expect(JSON.parse(screen.getByTestId('reading-statistics').getAttribute('data-query')!)).toEqual(day)

    const all = { timezone: 'Asia/Shanghai' }
    rerender(<ArchiveOverviewDashboard baseSearch={{}} query={all} period="all" />)
    expect(mockOverview).toHaveBeenLastCalledWith(all)
    expect(JSON.parse(screen.getByTestId('reading-statistics').getAttribute('data-query')!)).toEqual(all)
  })

  it('does not display zero notes when the scoped count request has no data', () => {
    mockOverview.mockReturnValue({ isPending: false, isError: false })
    render(<ArchiveOverviewDashboard baseSearch={{}} />)
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('uses the live overview counts and sends type changes to the current sidebar', () => {
    const overview: ArchiveOverview = { counts: { highlights: 83, bookmarks: 2, ideas: 7, reviews: 1, total: 93 }, totalBooks: 12 }
    mockOverview.mockReturnValue({ data: { data: overview }, isPending: false, isError: false })
    const onSelectType = vi.fn()
    render(<ArchiveOverviewDashboard baseSearch={{ sort: 'most' }} onSelectType={onSelectType} />)
    expect(screen.getByText('83')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    const card = screen.getByRole('button', { name: /书签 2/ })
    expect(JSON.parse(card.getAttribute('data-search')!)).toEqual({ sort: 'most', type: 'bookmark' })
    fireEvent.click(card)
    expect(onSelectType).toHaveBeenCalledWith('bookmark')
    expect(screen.getByTestId('reading-statistics')).toBeInTheDocument()
  })
})

describe('archive display helpers', () => {
  it('hides whitespace and punctuation-only source excerpts without rejecting short text', () => {
    expect(hasReadableText('   ')).toBe(false)
    expect(hasReadableText('。')).toBe(false)
    expect(hasReadableText('好')).toBe(true)
    expect(hasReadableText('OK')).toBe(true)
  })

  it('lists nonzero counts in card order without measure words', () => {
    const t = (key: string) => ({ 'archive.highlights': '划线', 'archive.bookmarks': '书签', 'archive.ideas': '想法', 'archive.reviews': '书评' })[key]!
    expect(archiveCountParts({ highlights: 5, bookmarks: 0, ideas: 4, reviews: 1 }, t)).toEqual([
      { key: 'highlights', label: '划线', value: 5 },
      { key: 'ideas', label: '想法', value: 4 },
      { key: 'reviews', label: '书评', value: 1 },
    ])
    expect(archiveCountParts({ highlights: 0, bookmarks: 0, ideas: 0, reviews: 0 }, t)).toEqual([])
  })
})

describe('SortMenu', () => {
  const options = [
    { value: 'chapter' as const, label: '章节顺序' },
    { value: 'recent' as const, label: '最近记录' },
  ]

  it('shows the active option and notifies on pick', () => {
    const onChange = vi.fn()
    render(<SortMenu value="chapter" options={options} onChange={onChange} label="排序方式" />)
    fireEvent.click(screen.getByRole('button', { name: '章节顺序' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: '章节顺序' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '最近记录' }))
    expect(onChange).toHaveBeenCalledWith('recent')
  })
})
