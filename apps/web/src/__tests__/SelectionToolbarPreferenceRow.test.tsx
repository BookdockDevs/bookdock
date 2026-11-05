import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DEFAULT_SELECTION_TOOLBAR_ORDER } from '@bookdock/shared'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

import { useUiStore } from '@/stores/ui.store'
import SelectionToolbarPreferenceRow from '@/features/settings/components/SelectionToolbarPreferenceRow'

describe('SelectionToolbarPreferenceRow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useUiStore.getState().resetSelectionToolbar()
  })

  it('renders all 11 action buttons in the current order', () => {
    render(<SelectionToolbarPreferenceRow />)
    const buttons = screen.getAllByRole('button', { pressed: true })
    expect(buttons).toHaveLength(11)
  })

  it('toggles visibility when an icon button is clicked', () => {
    render(<SelectionToolbarPreferenceRow />)
    // Find the replace button by title/aria-label
    const replaceBtn = screen.getByTitle('annotation.replace')
    expect(replaceBtn).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(replaceBtn)
    expect(useUiStore.getState().selectionToolbarHidden).toContain('replace')

    // Click again to re-enable
    fireEvent.click(replaceBtn)
    expect(useUiStore.getState().selectionToolbarHidden).not.toContain('replace')
  })

  it('prevents disabling the last remaining active action', () => {
    // Hide 10 actions so only 1 remains
    const allExceptOne = DEFAULT_SELECTION_TOOLBAR_ORDER.slice(1)
    useUiStore.setState({ selectionToolbarHidden: allExceptOne })

    render(<SelectionToolbarPreferenceRow />)
    const lastActive = screen.getByTitle('annotation.drawHighlight / annotation.deleteHighlight')
    expect(lastActive).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(lastActive)
    // Still not hidden
    expect(useUiStore.getState().selectionToolbarHidden).toEqual(allExceptOne)
  })

  it('shows restore default button when modified, and resets on click', () => {
    const { rerender } = render(<SelectionToolbarPreferenceRow />)
    expect(screen.queryByText('settings.resetDefault')).toBeNull()

    // Hide an action
    useUiStore.getState().toggleSelectionToolbarActionVisible('copy')
    rerender(<SelectionToolbarPreferenceRow />)

    const resetBtn = screen.getByText('settings.resetDefault')
    expect(resetBtn).toBeInTheDocument()

    fireEvent.click(resetBtn)
    expect(useUiStore.getState().selectionToolbarHidden).toEqual([])
    expect(useUiStore.getState().selectionToolbarOrder).toEqual(DEFAULT_SELECTION_TOOLBAR_ORDER)
  })
})
