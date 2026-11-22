import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import Toggle from '../components/ui/Toggle'

describe('Toggle', () => {
  it('calls onChange with the flipped value', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} ariaLabel="switch" />)

    fireEvent.click(screen.getByRole('switch', { name: 'switch' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders the visible label and uses it as the accessible name', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Regex" />)

    const toggle = screen.getByRole('switch', { name: 'Regex' })
    expect(toggle).toHaveTextContent('Regex')
  })

  it('supports md size and busy state', () => {
    render(<Toggle checked={true} size="md" busy disabled onChange={() => {}} ariaLabel="Pending" />)

    const toggle = screen.getByRole('switch', { name: 'Pending' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('aria-busy', 'true')
    expect(toggle).toBeDisabled()
  })
})
