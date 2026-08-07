import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ProgressStrip } from '../features/reader/components/ProgressStrip'

import type { Chapter } from '@bookdock/shared'

const chapters: Chapter[] = [
  { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: 100, wordCount: 100 },
  { id: 'ch-1', title: '第二章', level: 1, startOffset: 100, endOffset: 200, wordCount: 100 },
]

// byte model: two equal sections -> boundaries at 50%
const sectionFractions = [0.5, 1]

function renderStrip(overrides: Partial<Parameters<typeof ProgressStrip>[0]> = {}) {
  const onSeek = vi.fn()
  const view = render(
    <ProgressStrip
      percent={30}
      pageInfo={{ page: 1, total: 2 }}
      visible
      chapters={chapters}
      sectionFractions={sectionFractions}
      onPrevChapter={vi.fn()}
      onNextChapter={vi.fn()}
      onPageUp={vi.fn()}
      onPageDown={vi.fn()}
      onSeek={onSeek}
      {...overrides}
    />,
  )
  return { onSeek, view }
}

describe('ProgressStrip drag preview', () => {
  it('shows the real chapter and percent when idle', () => {
    renderStrip()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('previews the dragged chapter text, percent and chapter badge while dragging', () => {
    renderStrip()
    const slider = screen.getByRole('slider', { name: '阅读进度' })
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '75' } })
    // 75% lands in the second chapter (0-50 / 50-100)
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('第二章')).toBeInTheDocument()
  })

  it('seeks the dragged value and clears the preview on release', () => {
    const { onSeek } = renderStrip()
    const slider = screen.getByRole('slider', { name: '阅读进度' })
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '75' } })
    fireEvent.pointerUp(slider)
    expect(onSeek).toHaveBeenCalledWith(75)
    expect(screen.queryByText('第二章')).not.toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('degrades to plain seek when section boundaries are unavailable', () => {
    renderStrip({ sectionFractions: null })
    const slider = screen.getByRole('slider', { name: '阅读进度' })
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '60' } })
    fireEvent.pointerUp(slider)
    expect(screen.queryByText('第二章')).not.toBeInTheDocument()
  })
})
