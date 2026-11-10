import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import DefaultAddDestinationRow from '../features/settings/components/DefaultAddDestinationRow'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

describe('DefaultAddDestinationRow', () => {
  beforeEach(() => {
    useUiStore.setState({ defaultAddDestination: 'server' })
    useAuthStore.setState({ user: { id: 'u-1', username: 'reader', role: 'user' } })
  })

  it('renders a segmented control with aria-pressed state and hint', () => {
    render(<DefaultAddDestinationRow />)

    expect(screen.getByText('library.defaultAddDestinationHint')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'library.defaultAddDestination' })
    expect(group).toBeInTheDocument()

    const serverBtn = screen.getByRole('button', { name: 'library.sourceRemote' })
    const localBtn = screen.getByRole('button', { name: 'library.sourceLocal' })
    expect(serverBtn).toHaveAttribute('aria-pressed', 'true')
    expect(localBtn).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(localBtn)
    expect(useUiStore.getState().defaultAddDestination).toBe('local')
    expect(localBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('disables server option and reflects local fallback when serverUploadDisabled is true for non-owners', () => {
    render(<DefaultAddDestinationRow serverUploadDisabled />)

    const serverBtn = screen.getByRole('button', { name: 'library.sourceRemote' })
    const localBtn = screen.getByRole('button', { name: 'library.sourceLocal' })
    expect(serverBtn).toBeDisabled()
    expect(serverBtn).toHaveAttribute('aria-pressed', 'false')
    expect(localBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps server option enabled for the instance owner even when member uploads are disabled', () => {
    useAuthStore.setState({ user: { id: 'u-owner', username: 'owner', role: 'owner' } })
    render(<DefaultAddDestinationRow serverUploadDisabled />)

    const serverBtn = screen.getByRole('button', { name: 'library.sourceRemote' })
    expect(serverBtn).not.toBeDisabled()
    expect(serverBtn).toHaveAttribute('aria-pressed', 'true')
  })
})
