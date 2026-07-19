import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsPopover } from '../features/reader/components/SettingsPopover'

describe('SettingsPopover', () => {
  it('does not render when closed', () => {
    render(
      <SettingsPopover open={false} onClose={vi.fn()}>
        <div data-testid="content">settings</div>
      </SettingsPopover>,
    )
    expect(screen.queryByTestId('content')).not.toBeInTheDocument()
  })

  it('renders children when open', () => {
    render(
      <SettingsPopover open onClose={vi.fn()}>
        <div data-testid="content">settings</div>
      </SettingsPopover>,
    )
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('closes when clicking outside', () => {
    const onClose = vi.fn()
    render(
      <div>
        <SettingsPopover open onClose={onClose}>
          <div>settings</div>
        </SettingsPopover>
        <button data-testid="outside">outside</button>
      </div>,
    )
    fireEvent.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking inside', () => {
    const onClose = vi.fn()
    render(
      <SettingsPopover open onClose={onClose}>
        <button data-testid="inside">inside</button>
      </SettingsPopover>,
    )
    fireEvent.click(screen.getByTestId('inside'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(
      <SettingsPopover open onClose={onClose}>
        <div>settings</div>
      </SettingsPopover>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
