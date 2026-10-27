import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ContentEditorPending from './ContentEditorPending'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

describe('ContentEditorPending', () => {
  it('announces the opening and content loading stages', () => {
    const { rerender } = render(<ContentEditorPending />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('editor.opening')).toBeInTheDocument()

    rerender(<ContentEditorPending stage="content" />)
    expect(screen.getByText('editor.loadingContent')).toBeInTheDocument()
  })
})
