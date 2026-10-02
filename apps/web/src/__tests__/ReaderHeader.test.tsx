import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReaderHeader } from '../features/reader/components/ReaderHeader'
import { IDLE_TTS_STATE, TtsSessionContext } from '../features/reader/hooks/tts-session-context'
import { AutoReadingSessionContext, IDLE_AUTO_READING_STATE } from '../features/reader/hooks/auto-reading-session-context'
import type { AutoReadingController } from '../features/reader/lib/auto-reading'
import type { TtsController } from '../features/reader/lib/tts-controller'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    history: {
      canGoBack: () => false,
      back: vi.fn(),
    },
  }),
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

    const bookmarkButton = screen.getByTitle('移除书签')
    expect(bookmarkButton).toHaveClass('border-current', 'text-current')
    expect(bookmarkButton).toHaveAttribute('aria-label', '移除书签')
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
    expect(bookmarkButton).toHaveAttribute('aria-label', '添加书签')
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

  it('notifies onAutoReadingStart when auto reading begins so the reader can unpin the chrome', async () => {
    const start = vi.fn(async () => {})
    const onAutoReadingStart = vi.fn()
    render(
      <AutoReadingSessionContext.Provider
        value={{ controller: { start } as unknown as AutoReadingController, state: IDLE_AUTO_READING_STATE }}
      >
        <ReaderHeader
          title="测试书籍"
          visible
          autoReadingOpen
          onToggleAutoReading={vi.fn()}
          onAutoReadingStart={onAutoReadingStart}
        />
      </AutoReadingSessionContext.Provider>,
    )

    fireEvent.click(screen.getByText('reader.autoReadingStart'))
    expect(start).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onAutoReadingStart).toHaveBeenCalledTimes(1))
  })

  it('notifies onTtsStart synchronously when TTS begins so the reader can unpin the chrome', () => {
    const start = vi.fn(async () => {})
    const onTtsStart = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <TtsSessionContext.Provider
          value={{ controller: { start } as unknown as TtsController, state: IDLE_TTS_STATE }}
        >
          <ReaderHeader
            title="测试书籍"
            visible
            ttsOpen
            onToggleTts={vi.fn()}
            onTtsStart={onTtsStart}
          />
        </TtsSessionContext.Provider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByText('reader.ttsPlay'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(onTtsStart).toHaveBeenCalledTimes(1)
  })
})
