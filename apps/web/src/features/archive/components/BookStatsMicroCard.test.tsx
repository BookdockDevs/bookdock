import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadingRecordBookDetailRes } from '@bookdock/shared'

import i18n from '@/i18n/i18n'

import BookStatsMicroCard from './BookStatsMicroCard'

const timing: ReadingRecordBookDetailRes = {
  totalSeconds: 120,
  records: [{ date: '2026-10-01', durationSeconds: 1 }, { date: '2026-10-02', durationSeconds: 59 }, { date: '2026-10-03', durationSeconds: 60 }],
}
const state = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/api/hooks/reading-records', () => ({ useBookReadingRecords: (...args: unknown[]) => { state.query(...args); return { data: { data: timing }, isPending: false } } }))
vi.mock('@/features/library/hooks', () => ({ useBook: () => ({ data: undefined, isPending: false }) }))

beforeEach(async () => { await i18n.changeLanguage('zh-CN') })

describe('book note statistics', () => {
  it('uses the same sixty-second reading-day threshold as the data views', () => {
    render(<BookStatsMicroCard bookVersionId="b1" />)
    expect(screen.getByText('阅读天数').parentElement).toHaveTextContent('1 天')
    expect(screen.getByText('本书用时').parentElement).toHaveTextContent('2 分钟')
  })

  it('passes the shared range to reading queries and omits lifetime position context', () => {
    const range = { from: '2026-10-02', to: '2026-10-03', timezone: 'Asia/Shanghai' }
    render(<BookStatsMicroCard bookVersionId="b1" range={range} />)
    expect(state.query).toHaveBeenCalledWith('b1', { range })
    expect(screen.queryByText('阅读进度')).not.toBeInTheDocument()
    expect(screen.queryByText('最近阅读')).not.toBeInTheDocument()
  })
})
