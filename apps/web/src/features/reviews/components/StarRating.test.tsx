import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StarRating from './StarRating'

// The shared jsdom setup boots no i18next instance, so labels fall back to
// raw keys (same convention as the reader AiPanel tests).
describe('StarRating', () => {
  it('renders ten half-star radio options and reports the chosen step', () => {
    const onChange = vi.fn()
    render(<StarRating value={null} onChange={onChange} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(10)
    fireEvent.click(radios[0]!)
    expect(onChange).toHaveBeenCalledWith(0.5)
    fireEvent.click(radios[9]!)
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('shows the input with no selection and clears back to it', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StarRating value={null} onChange={onChange} />)
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    expect(screen.queryByText('review.clearRating')).toBeNull()
    rerender(<StarRating value={2.5} onChange={onChange} />)
    expect(screen.getAllByRole('radio').filter((el) => el.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    fireEvent.click(screen.getByText('review.clearRating'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('displays halves without an input', () => {
    render(<StarRating value={3.5} size={10} />)
    expect(screen.getByRole('img')).toBeDefined()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('keeps one tab stop and moves with arrow keys', () => {
    const onChange = vi.fn()
    render(<StarRating value={1} onChange={onChange} />)
    const radios = screen.getAllByRole('radio')
    expect(radios.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(radios[1]!.getAttribute('tabindex')).toBe('0')
    ;(radios[1]! as HTMLElement).focus()
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(1.5)
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith(0.5)
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('does not preview fills on keyboard focus alone', () => {
    const onChange = vi.fn()
    const { container } = render(<StarRating value={1} onChange={onChange} />)
    // Focusing without the mouse must not paint a hover preview: only the
    // selected value's halves stay filled.
    ;(screen.getAllByRole('radio')[0]! as HTMLElement).focus()
    const filled = container.querySelectorAll('.fill-amber-400')
    // value 1 → exactly two filled halves (both slices of the first star).
    expect(filled).toHaveLength(2)
  })
})
