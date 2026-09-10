import type { ReactNode } from 'react'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ErrorBoundary from '@/components/ui/ErrorBoundary'
import i18n from '@/i18n/i18n'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

function BrokenContent() {
  throw new Error('sensitive internal error')
}

describe('ErrorBoundary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the current Chinese locale and hides internal error details', () => {
    render(
      <ErrorBoundary>
        <BrokenContent />
      </ErrorBoundary>,
    )

    expect(screen.getByText('页面出现异常')).toBeInTheDocument()
    expect(screen.getByText('请刷新页面后重试；如果问题仍然存在，请返回书库。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回书库' })).toBeInTheDocument()
    expect(screen.queryByText('sensitive internal error')).not.toBeInTheDocument()
  })

  it('uses the current English locale when the language is English', async () => {
    await i18n.changeLanguage('en')

    render(
      <ErrorBoundary>
        <BrokenContent />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Library' })).toBeInTheDocument()
  })
})
