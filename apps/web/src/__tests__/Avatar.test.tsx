import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Avatar from '@/components/ui/Avatar'

describe('Avatar', () => {
  it('keeps decorative avatars out of identity link names in every image state', () => {
    const { rerender, container } = render(<a href="/profile"><Avatar decorative name="Reader" />Reader</a>)
    expect(screen.getByRole('link')).toHaveAccessibleName('Reader')

    rerender(<a href="/profile"><Avatar decorative src="/avatar.png" name="Reader" />Reader</a>)
    expect(screen.getByRole('link')).toHaveAccessibleName('Reader')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    fireEvent.load(container.querySelector('img')!)
    expect(screen.getByRole('link')).toHaveAccessibleName('Reader')
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByRole('link')).toHaveAccessibleName('Reader')
  })

  it('keeps the initial and image text invisible until the image loads', () => {
    render(<Avatar src="/avatar.png" name="Alice" className="h-8 w-8" />)
    const image = screen.getByRole('img', { name: 'Alice' })
    expect(image).toHaveClass('opacity-0')
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    fireEvent.load(image)
    expect(image).not.toHaveClass('opacity-0')
  })

  it('falls back after failure and resets when the URL changes', () => {
    const { rerender } = render(<Avatar src="/broken.png" name="Alice" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(<Avatar src="/new.png" name="Alice" />)
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveClass('opacity-0')
    fireEvent.load(screen.getByRole('img'))
    rerender(<Avatar src="/third.png" name="Alice" />)
    expect(screen.getByRole('img')).toHaveClass('opacity-0')
    rerender(<Avatar src="/new.png" name="Alice" />)
    expect(screen.getByRole('img')).toHaveClass('opacity-0')
  })

  it('uses a full Unicode initial without an image and updates after removal', () => {
    const { rerender } = render(<Avatar name="📚 Reader" />)
    expect(screen.getByText('📚')).toBeInTheDocument()
    rerender(<Avatar src="/avatar.png" name="Alice" />)
    fireEvent.load(screen.getByRole('img'))
    rerender(<Avatar name="Bob" />)
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows an already cached image without waiting for another load event', () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete')!
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')!
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 })
    try {
      render(<Avatar src="/cached.png" name="Alice" />)
      expect(screen.getByRole('img')).not.toHaveClass('opacity-0')
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'complete', descriptor)
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', widthDescriptor)
    }
  })
})
