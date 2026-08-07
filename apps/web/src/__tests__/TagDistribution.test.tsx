import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../i18n/i18n'

import TagDistribution from '../features/stats/components/TagDistribution'
import { periodRange } from '../features/stats/date-utils'
import { useReadingByTag } from '@/api/hooks/reading-records'
import type { ReadingRecordTagItem } from '@bookdock/shared'

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return {
    ...original,
    useReadingByTag: vi.fn(),
  }
})

// Pin the locale keys used here to identity values so assertions stay stable
const STATS_KEYS = ['tagDistribution', 'emptyTags', 'tagOther']

type Mock = ReturnType<typeof vi.fn>

const TAGS: ReadingRecordTagItem[] = [
  { tagId: 't1', name: '科幻', durationSeconds: 3600 },
  { tagId: 't2', name: '文学', durationSeconds: 1200 },
]

function renderChart() {
  const range = periodRange('week', new Date())
  return render(<TagDistribution date={null} period="week" range={range} />)
}

describe('TagDistribution', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    i18n.addResourceBundle(
      'zh-CN',
      'translation',
      { stats: Object.fromEntries(STATS_KEYS.map((k) => [k, `stats.${k}`])) },
      true,
      true,
    )
    await i18n.changeLanguage('zh-CN')
    ;(useReadingByTag as Mock).mockReturnValue({ data: { data: TAGS } })
  })

  it('renders the legend with names, durations and percentages', () => {
    const { container } = renderChart()
    expect(screen.getByText('stats.tagDistribution')).toBeInTheDocument()
    expect(screen.getByText('科幻')).toBeInTheDocument()
    expect(screen.getByText('文学')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(container.querySelectorAll('circle')).toHaveLength(2)
  })

  it('merges the tail into an "other" slice beyond 8 tags', () => {
    const many: ReadingRecordTagItem[] = Array.from({ length: 10 }, (_, i) => ({
      tagId: `t${i}`,
      name: `Tag ${i}`,
      durationSeconds: 100 - i,
    }))
    ;(useReadingByTag as Mock).mockReturnValue({ data: { data: many } })
    const { container } = renderChart()
    expect(screen.getByText('Tag 7')).toBeInTheDocument()
    expect(screen.queryByText('Tag 8')).not.toBeInTheDocument()
    expect(screen.getByText('stats.tagOther')).toBeInTheDocument()
    expect(container.querySelectorAll('circle')).toHaveLength(9)
  })

  it('shows the guidance empty state without tagged reading', () => {
    ;(useReadingByTag as Mock).mockReturnValue({ data: { data: [] } })
    const { container } = renderChart()
    expect(screen.getByText('stats.emptyTags')).toBeInTheDocument()
    expect(container.querySelectorAll('circle')).toHaveLength(0)
  })
})
