import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ExpandingSearchBar } from '../features/reader/components/ExpandingSearchBar'

const noop = () => {}

describe('ExpandingSearchBar', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows history chips only when the input is empty', () => {
    const { rerender } = render(
      <ExpandingSearchBar expanded query="" placeholder="搜索" onQueryChange={noop} onCollapse={noop} history={['甲', '乙']} />,
    )
    expect(screen.getByText('甲')).toBeInTheDocument()
    expect(screen.getByText('乙')).toBeInTheDocument()
    rerender(
      <ExpandingSearchBar expanded query="甲" placeholder="搜索" onQueryChange={noop} onCollapse={noop} history={['甲', '乙']} />,
    )
    expect(screen.queryByText('甲')).not.toBeInTheDocument()
    expect(screen.queryByText('乙')).not.toBeInTheDocument()
  })

  it('hides the chips row when history is empty', () => {
    render(<ExpandingSearchBar expanded query="" placeholder="搜索" onQueryChange={noop} onCollapse={noop} history={[]} />)
    expect(screen.queryByTitle('reader.clearSearchHistory')).toBeNull()
  })

  it('fills the query on chip click', () => {
    const onHistoryClick = vi.fn()
    render(
      <ExpandingSearchBar expanded query="" placeholder="搜索" onQueryChange={noop} onCollapse={noop} history={['旧词']} onHistoryClick={onHistoryClick} />,
    )
    fireEvent.click(screen.getByText('旧词'))
    expect(onHistoryClick).toHaveBeenCalledWith('旧词')
  })

  it('clears history via the trash button', () => {
    const onClearHistory = vi.fn()
    render(
      <ExpandingSearchBar expanded query="" placeholder="搜索" onQueryChange={noop} onCollapse={noop} history={['旧词']} onClearHistory={onClearHistory} />,
    )
    fireEvent.click(screen.getByTitle('reader.clearSearchHistory'))
    expect(onClearHistory).toHaveBeenCalled()
  })
})
