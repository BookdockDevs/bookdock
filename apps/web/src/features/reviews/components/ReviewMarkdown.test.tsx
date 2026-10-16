import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ReviewMarkdown from './ReviewMarkdown'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

describe('ReviewMarkdown resource failures', () => {
  it('replaces unreadable managed images with an accurate unavailable state while preserving the body', () => {
    const { container } = render(<ReviewMarkdown body={'# Retained heading\n\n![managed](/api/v1/content-files/cfile_abcdefghijklmnopqrstu)\n\nStill here.'} format="markdown" />)
    const image = screen.getByRole('img', { name: 'managed' })
    fireEvent.error(image)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('contentFiles.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Retained heading' })).toBeInTheDocument()
    expect(container.textContent).toContain('Still here.')
    expect(container.textContent).not.toContain('cfile_')
    fireEvent.click(screen.getByRole('button', { name: 'contentFiles.retry' }))
    expect(screen.getByRole('img', { name: 'managed' })).toHaveAttribute('src', '/api/v1/content-files/cfile_abcdefghijklmnopqrstu')
    expect(screen.queryByText('contentFiles.unavailable')).toBeNull()
  })
})
