import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../i18n/i18n'
import AppendContentModal from '../features/library/components/AppendContentModal'

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  previewReset: vi.fn(),
  appendMutate: vi.fn(),
}))

vi.mock('../features/library/hooks', () => ({
  useAppendBookContentPreview: () => ({ mutate: mocks.previewMutate, reset: mocks.previewReset, isPending: false }),
  useAppendBookContent: () => ({ mutate: mocks.appendMutate, isPending: false }),
}))

const preview = {
  originalChapterCount: 1,
  originalWordCount: 100,
  newChapterCount: 2,
  newWordCount: 180,
  addedChapterCount: 1,
  addedWordCount: 80,
  candidateTextLength: 13,
  candidateChapters: [{ title: '第二章 续篇', level: 1, wordCount: 80, startOffset: 0 }],
  predictedStartIndex: 0,
  addedChapters: [{ title: '第二章 续篇', level: 1, wordCount: 80 }],
  appendedToLastChapter: false,
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

describe('AppendContentModal', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.previewMutate.mockImplementation((_input, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({ data: preview }))
    mocks.appendMutate.mockImplementation((_input, options: { onSuccess: () => void }) => options.onSuccess())
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces pasted text, shows the chapter diff, and saves the selected source', async () => {
    const onClose = vi.fn()
    render(<AppendContentModal bookId="book-1" onClose={onClose} />, { wrapper })

    fireEvent.click(screen.getByRole('tab', { name: '粘贴文本' }))
    fireEvent.change(screen.getByRole('textbox', { name: '粘贴文本' }), { target: { value: '第二章 续篇\n\n正文' } })
    await act(async () => {
      vi.advanceTimersByTime(349)
    })
    expect(mocks.previewMutate).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(mocks.previewMutate).toHaveBeenCalledWith(
      { bookId: 'book-1', text: '第二章 续篇\n\n正文' },
      expect.anything(),
    )
    expect(screen.getByText(/1 章 \(100字\)/)).toBeInTheDocument()
    expect(screen.getByText('第二章 续篇')).toBeInTheDocument()

    // Switch to file tab and back to text tab: should reuse cached preview without extra network mutation
    fireEvent.click(screen.getByRole('tab', { name: '上传文件' }))
    fireEvent.click(screen.getByRole('tab', { name: '粘贴文本' }))
    expect(mocks.previewMutate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('第二章 续篇')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '追加并保存' }))
    expect(mocks.appendMutate).toHaveBeenCalledWith(
      { bookId: 'book-1', text: '第二章 续篇\n\n正文', startOffset: 0 },
      expect.anything(),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('accepts a TXT file and submits it as multipart input', async () => {
    render(<AppendContentModal bookId="book-2" onClose={vi.fn()} />, { wrapper })
    const input = document.querySelector('input[type="file"]')!
    const file = new File(['第三章\n\n正文'], 'update.txt', { type: 'text/plain' })

    fireEvent.change(input, { target: { files: [file] } })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    expect(mocks.previewMutate).toHaveBeenCalledWith({ bookId: 'book-2', file }, expect.anything())
    expect(screen.getByText('update.txt')).toBeInTheDocument()
  })

  it('uses the predicted start by default and lets the user choose another chapter', async () => {
    const candidatePreview = {
      ...preview,
      newChapterCount: 3,
      newWordCount: 260,
      addedChapterCount: 1,
      addedWordCount: 80,
      candidateTextLength: 38,
      candidateChapters: [
        { title: '第二章 续篇', level: 1, wordCount: 100, startOffset: 0 },
        { title: '第三章 终章', level: 1, wordCount: 80, startOffset: 20 },
      ],
      predictedStartIndex: 1,
      addedChapters: [{ title: '第三章 终章', level: 1, wordCount: 80 }],
    }
    mocks.previewMutate.mockImplementation((_input, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({ data: candidatePreview }))
    render(<AppendContentModal bookId="book-3" onClose={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('tab', { name: '粘贴文本' }))
    fireEvent.change(screen.getByRole('textbox', { name: '粘贴文本' }), { target: { value: '第二章 续篇\n\n第三章 终章' } })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    expect(screen.getByText('已跳过前 1 章历史内容')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已跳过前 1 章历史内容/ }))
    fireEvent.click(screen.getAllByTitle('以此章为追加起点')[0]!)
    expect(screen.getByText('第二章 续篇')).toBeInTheDocument()
    expect(screen.getByText('新增 2 章 (+180字)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '追加并保存' }))

    expect(mocks.appendMutate).toHaveBeenCalledWith(
      { bookId: 'book-3', text: '第二章 续篇\n\n第三章 终章', startOffset: 0 },
      expect.anything(),
    )
  })
})
