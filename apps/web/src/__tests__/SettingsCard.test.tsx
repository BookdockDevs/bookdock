import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import SettingsCard from '../features/settings/components/SettingsCard'

describe('SettingsCard', () => {
  it('renders title, description, icon and action', () => {
    render(
      <SettingsCard
        icon={<span data-testid="test-icon">icon</span>}
        title="Module Title"
        description="Module Description"
        action={<button type="button">Action</button>}
      >
        <div>Card Body Content</div>
      </SettingsCard>,
    )

    expect(screen.getByText('Module Title')).toBeInTheDocument()
    expect(screen.getByText('Module Description')).toBeInTheDocument()
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
    expect(screen.getByText('Card Body Content')).toBeInTheDocument()
  })

  it('does not render body container when children is falsy', () => {
    const { container } = render(
      <SettingsCard
        icon={<span>icon</span>}
        title="Title Only"
      />,
    )

    expect(screen.getByText('Title Only')).toBeInTheDocument()
    expect(container.querySelector('.border-t')).toBeNull()
  })
})
