import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { NotesFilterPanel } from '../features/reader/components/NotesFilterPanel'
import type { ItemKind } from '../features/reader/hooks/useNotesFilter'
import type { AnnotationStyle } from '@bookdock/shared'

describe('NotesFilterPanel', () => {
  const anchorRef = createRef<HTMLButtonElement>()
  const mockOnClose = vi.fn()
  const mockOnToggleType = vi.fn()
  const mockOnSortChange = vi.fn()
  const mockOnToggleStyle = vi.fn()
  const mockOnToggleColor = vi.fn()
  const mockOnReset = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({ top: 10, bottom: 40, left: 100, right: 140, width: 40, height: 30 }),
    })
    ;(anchorRef as { current: HTMLButtonElement | null }).current = btn
  })

  function renderPanel(props: Partial<Parameters<typeof NotesFilterPanel>[0]> = {}) {
    return render(
      <NotesFilterPanel
        open={true}
        anchorRef={anchorRef}
        onClose={mockOnClose}
        displayTypes={new Set<ItemKind>(['highlight', 'idea', 'bookmark'])}
        onToggleType={mockOnToggleType}
        sort="chapter"
        onSortChange={mockOnSortChange}
        styleFilter={new Set<AnnotationStyle>()}
        colorFilter={new Set<string>()}
        onToggleStyle={mockOnToggleStyle}
        onToggleColor={mockOnToggleColor}
        onReset={mockOnReset}
        {...props}
      />,
    )
  }

  it('renders all filter sections and default states', () => {
    renderPanel()

    expect(screen.getByText('annotation.filterType')).toBeInTheDocument()
    expect(screen.getByText('annotation.filterStyle')).toBeInTheDocument()
    expect(screen.getByText('annotation.filterColor')).toBeInTheDocument()
    expect(screen.getByText('reader.sort')).toBeInTheDocument()
    expect(screen.getByText('reader.sortChapter')).toBeInTheDocument()
    expect(screen.getByText('reader.sortTimeDesc')).toBeInTheDocument()

    // Reset button is disabled when at default
    const resetBtn = screen.getByRole('button', { name: 'annotation.reset' })
    expect(resetBtn).toBeDisabled()
  })

  it('flips chapter sort order when clicking active chapter sort button', () => {
    const { rerender } = renderPanel({ sort: 'chapter' })

    const chapterBtn = screen.getByTitle('reader.sortChapter')
    fireEvent.click(chapterBtn)
    expect(mockOnSortChange).toHaveBeenCalledWith('chapter-desc')

    // Rerender with chapter-desc and click again to flip back
    rerender(
      <NotesFilterPanel
        open={true}
        anchorRef={anchorRef}
        onClose={mockOnClose}
        displayTypes={new Set<ItemKind>(['highlight', 'idea', 'bookmark'])}
        onToggleType={mockOnToggleType}
        sort="chapter-desc"
        onSortChange={mockOnSortChange}
        styleFilter={new Set<AnnotationStyle>()}
        colorFilter={new Set<string>()}
        onToggleStyle={mockOnToggleStyle}
        onToggleColor={mockOnToggleColor}
        onReset={mockOnReset}
      />,
    )
    const reverseBtn = screen.getByTitle('reader.sortChapterReverse')
    fireEvent.click(reverseBtn)
    expect(mockOnSortChange).toHaveBeenCalledWith('chapter')
  })

  it('switches to time sort on inactive click and flips direction on active click', () => {
    const { rerender } = renderPanel({ sort: 'chapter' })

    // Clicking time button while chapter is active switches to time-desc
    const timeBtn = screen.getByTitle('reader.sortTimeDesc')
    fireEvent.click(timeBtn)
    expect(mockOnSortChange).toHaveBeenCalledWith('time-desc')

    // When time-desc is active, clicking it flips to time-asc
    rerender(
      <NotesFilterPanel
        open={true}
        anchorRef={anchorRef}
        onClose={mockOnClose}
        displayTypes={new Set<ItemKind>(['highlight', 'idea', 'bookmark'])}
        onToggleType={mockOnToggleType}
        sort="time-desc"
        onSortChange={mockOnSortChange}
        styleFilter={new Set<AnnotationStyle>()}
        colorFilter={new Set<string>()}
        onToggleStyle={mockOnToggleStyle}
        onToggleColor={mockOnToggleColor}
        onReset={mockOnReset}
      />,
    )
    fireEvent.click(screen.getByTitle('reader.sortTimeDesc'))
    expect(mockOnSortChange).toHaveBeenCalledWith('time-asc')
  })

  it('toggles note types and styles', () => {
    renderPanel()

    fireEvent.click(screen.getByText('annotation.idea'))
    expect(mockOnToggleType).toHaveBeenCalledWith('idea')

    const highlightStyleBtn = screen.getByTitle('annotation.styleHighlight')
    fireEvent.click(highlightStyleBtn)
    expect(mockOnToggleStyle).toHaveBeenCalledWith('highlight')
  })

  it('toggles color filter and enables reset button when filtered', () => {
    const { rerender } = renderPanel({ colorFilter: new Set() })

    const redColorBtn = screen.getByTitle('annotation.colorRed')
    expect(redColorBtn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(redColorBtn)
    expect(mockOnToggleColor).toHaveBeenCalledWith('red')

    // Rerender with red selected
    rerender(
      <NotesFilterPanel
        open={true}
        anchorRef={anchorRef}
        onClose={mockOnClose}
        displayTypes={new Set<ItemKind>(['highlight', 'idea', 'bookmark'])}
        onToggleType={mockOnToggleType}
        sort="chapter"
        onSortChange={mockOnSortChange}
        styleFilter={new Set<AnnotationStyle>()}
        colorFilter={new Set<string>(['red'])}
        onToggleStyle={mockOnToggleStyle}
        onToggleColor={mockOnToggleColor}
        onReset={mockOnReset}
      />,
    )

    const selectedRedBtn = screen.getByTitle('annotation.colorRed')
    expect(selectedRedBtn).toHaveAttribute('aria-pressed', 'true')

    // Reset button is now active
    const resetBtn = screen.getByRole('button', { name: 'annotation.reset' })
    expect(resetBtn).not.toBeDisabled()
    fireEvent.click(resetBtn)
    expect(mockOnReset).toHaveBeenCalled()
  })
})
