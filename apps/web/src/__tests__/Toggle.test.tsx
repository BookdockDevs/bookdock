import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import Toggle from '../components/ui/Toggle'

describe('Toggle', () => {
  it('renders the off state: gray track, knob on the left', () => {
    render(<Toggle checked={false} onChange={() => {}} ariaLabel="switch" />)

    const track = screen.getByRole('switch', { name: 'switch' })
    expect(track).toHaveAttribute('aria-checked', 'false')
    const knob = track.firstElementChild!.firstElementChild!
    expect(track.firstElementChild!.className).toContain('bg-stone-200')
    expect(knob.className).toContain('left-0.5')
    expect(knob.className).toContain('bg-white')
    expect(knob.className).not.toContain('translate-x-4')
  })

  it('renders the on state: dark track, knob translated to the right', () => {
    render(<Toggle checked onChange={() => {}} ariaLabel="switch" />)

    const track = screen.getByRole('switch', { name: 'switch' })
    expect(track).toHaveAttribute('aria-checked', 'true')
    const knob = track.firstElementChild!.firstElementChild!
    expect(track.firstElementChild!.className).toContain('bg-stone-900')
    expect(knob.className).toContain('bg-white')
    expect(knob.className).toContain('translate-x-4')
  })

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
})
