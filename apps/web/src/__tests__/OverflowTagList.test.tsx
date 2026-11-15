import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import OverflowTagList from '../features/library/components/book-detail/OverflowTagList'

describe('OverflowTagList', () => {
  it('renders nothing when tags array is empty', () => {
    const { container } = render(<OverflowTagList tags={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders all tags inline when tags count is 5 or fewer', () => {
    const tags = ['武侠', '仙侠', '穿越', '后宫', '爽文']
    render(<OverflowTagList tags={tags} />)

    for (const tag of tags) {
      expect(screen.getByText(tag)).toBeInTheDocument()
    }
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('truncates to first 4 tags and displays overflow count when more than 5 tags', () => {
    const tags = ['NTL', '剧情', '后宫', '熟女', '人妻', '足交', '古风', '背德', '御姐', '端庄']
    render(<OverflowTagList tags={tags} />)

    // First 4 tags are visible inline
    expect(screen.getByText('NTL')).toBeInTheDocument()
    expect(screen.getByText('剧情')).toBeInTheDocument()
    expect(screen.getByText('后宫')).toBeInTheDocument()
    expect(screen.getByText('熟女')).toBeInTheDocument()

    // 5th tag and beyond are not rendered inline before menu open
    expect(screen.queryByText('人妻')).toBeNull()

    // Overflow button shows +6
    const moreBtn = screen.getByText('+6')
    expect(moreBtn).toBeInTheDocument()
  })

  it('opens popover showing all tags when clicking overflow badge and triggers onTagClick', () => {
    const onTagClick = vi.fn()
    const tags = ['NTL', '剧情', '后宫', '熟女', '人妻', '足交', '古风', '背德', '御姐', '端庄']
    render(<OverflowTagList tags={tags} onTagClick={onTagClick} />)

    const moreBtn = screen.getByText('+6')
    fireEvent.click(moreBtn)

    // Popover opens and shows all tags (including the 5th tag and beyond)
    expect(screen.getByText(/allTags.*10|全部标签.*10/)).toBeInTheDocument()
    const renQiBtn = screen.getByRole('button', { name: '人妻' })
    expect(renQiBtn).toBeInTheDocument()

    fireEvent.click(renQiBtn)
    expect(onTagClick).toHaveBeenCalledWith('人妻')
  })
})
