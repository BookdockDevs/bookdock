import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { ReaderHeader } from '../features/reader/components/ReaderHeader'
import { IDLE_TTS_STATE, TtsSessionContext } from '../features/reader/hooks/tts-session-context'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}))

describe('ReaderHeader', () => {
  it('renders bookmark icon filled when bookmark is active', () => {
    render(
      <ReaderHeader
        title="测试书籍"
        visible
        bookmarkActive
        onAddBookmark={vi.fn()}
        onToggleSettings={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const bookmarkButton = screen.getByTitle('添加书签')
    expect(bookmarkButton).toHaveClass('border-current', 'text-current')
    const svg = bookmarkButton.querySelector('svg')
    expect(svg).toHaveAttribute('fill', 'currentColor')
  })

  it('renders bookmark icon outlined when bookmark is inactive', () => {
    render(
      <ReaderHeader
        title="测试书籍"
        visible
        bookmarkActive={false}
        onAddBookmark={vi.fn()}
        onToggleSettings={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    const bookmarkButton = screen.getByTitle('添加书签')
    expect(bookmarkButton).toHaveClass('border-[var(--bd-read-accent)]', 'text-[var(--bd-read-text)]')
    const svg = bookmarkButton.querySelector('svg')
    expect(svg).toHaveAttribute('fill', 'none')
  })

  it('highlights the TTS button and switches to a speaker while reading', () => {
    render(
      <TtsSessionContext.Provider value={{ controller: null, state: { ...IDLE_TTS_STATE, status: 'playing' } }}>
        <ReaderHeader
          title="测试书籍"
          visible
          onToggleTts={vi.fn()}
        />
      </TtsSessionContext.Provider>,
    )

    const ttsButton = screen.getByTitle('reader.ttsTitle')
    expect(ttsButton).toHaveClass('border-current', 'text-current')
    expect(ttsButton).not.toHaveClass('bg-[var(--bd-read-primary)]')
    expect(ttsButton.querySelector('svg')).toHaveClass('h-4', 'w-4')
    expect(ttsButton.querySelector('svg')).toHaveAttribute('fill', 'currentColor')
  })

  it('orders reading controls before bookmark, fullscreen, and settings', () => {
    render(
      <ReaderHeader
        title="测试书籍"
        visible
        onAddBookmark={vi.fn()}
        onToggleTts={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onToggleSettings={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual([
      'reader.ttsTitle',
      '添加书签',
      '全屏',
      '设置',
    ])
  })
})
