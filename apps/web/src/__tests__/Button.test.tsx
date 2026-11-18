import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../components/ui/Button'

describe('Button', () => {
  it('calls onClick when clicked', () => {
    let clicked = false
    render(<Button onClick={() => { clicked = true }}>Click</Button>)
    screen.getByText('Click').click()
    expect(clicked).toBe(true)
  })
})
