import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import BookReadingTrendChart from './BookReadingTrendChart'

describe('BookReadingTrendChart', () => {
  it('shows dated duration facts in time mode when progress coverage is unavailable', () => {
    const { container } = render(<BookReadingTrendChart points={[
      { date: '2026-10-31', seconds: 3222, progressPercent: null },
      { date: '2026-11-01', seconds: 6752, progressPercent: null },
      { date: '2026-11-02', seconds: 14458, progressPercent: null },
    ]} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('暂无阅读趋势数据')).not.toBeInTheDocument()
  })

  it('does not invent progress points when coverage is unavailable', () => {
    render(<BookReadingTrendChart points={[
      { date: '2026-10-31', seconds: 3222, progressPercent: null },
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: '进度' }))

    expect(screen.getByText('暂无阅读趋势数据')).toBeInTheDocument()
  })
})
