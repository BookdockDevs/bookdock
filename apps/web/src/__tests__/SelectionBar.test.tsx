import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { useToastStore } from '@/stores/toast.store'

import SelectionBar from '../features/library/components/SelectionBar'

const apiPatch = vi.fn()
const apiPut = vi.fn()
const apiPost = vi.fn()
const apiDelete = vi.fn()

vi.mock('@/api/client', () => ({
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  apiPut: (...args: unknown[]) => apiPut(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
}))

vi.mock('../features/library/hooks', () => ({
  useShelves: () => ({ data: { data: [] } }),
  useTags: () => ({ data: { data: [] } }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  apiPatch.mockResolvedValue({})
  apiPut.mockResolvedValue({})
  apiPost.mockResolvedValue({})
  apiDelete.mockResolvedValue({})
})

describe('SelectionBar', () => {
  it('applies batch read status to every selected book and clears selection', async () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b', 'c']} onClear={onClear} />, { wrapper })

    fireEvent.click(screen.getByText('library.markFinished'))

    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(apiPatch).toHaveBeenCalledTimes(3)
    expect(apiPatch).toHaveBeenCalledWith('/books/a', { readStatus: 'finished' })
    expect(apiPatch).toHaveBeenCalledWith('/books/c', { readStatus: 'finished' })
  })

  it('keeps selection and shows a summary toast when some updates fail', async () => {
    apiPatch.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({})
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b', 'c']} onClear={onClear} />, { wrapper })

    fireEvent.click(screen.getByText('library.markFinished'))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(3))
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.message === 'library.batchPartial' && t.type === 'error')).toBe(true)
    })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('batch delete calls the api per book and clears selection', async () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={onClear} />, { wrapper })

    fireEvent.click(screen.getByText('library.batchDelete'))
    const deleteButtons = screen.getAllByRole('button', { name: 'library.batchDelete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(apiDelete).toHaveBeenCalledTimes(2)
    expect(apiDelete).toHaveBeenCalledWith('/books/a')
  })

  it('opens classify dialog', () => {
    render(<SelectionBar selectedIds={['a']} onClear={vi.fn()} />, { wrapper })
    fireEvent.click(screen.getByText('library.batchClassify'))
    expect(screen.getByText('library.batchClassifyConfirm')).toBeInTheDocument()
  })

  it('clears selection via clear button', () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a']} onClear={onClear} />, { wrapper })
    screen.getByRole('button', { name: 'library.clearSelection' }).click()
    expect(onClear).toHaveBeenCalled()
  })

  it('trash mode shows restore/permanent actions instead of library batch actions', () => {
    render(<SelectionBar selectedIds={['a']} onClear={vi.fn()} trash />, { wrapper })
    expect(screen.getByText('library.restore')).toBeTruthy()
    expect(screen.getByText('library.permanentDelete')).toBeTruthy()
    expect(screen.queryByText('library.batchClassify')).toBeNull()
    expect(screen.queryByText('library.batchDelete')).toBeNull()
  })

  it('trash mode batch restore calls the restore api per book and clears selection', async () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={onClear} trash />, { wrapper })

    fireEvent.click(screen.getByText('library.restore'))

    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(apiPost).toHaveBeenCalledWith('/books/a/restore')
    expect(apiPost).toHaveBeenCalledWith('/books/b/restore')
  })

  it('trash mode batch permanent delete confirms then calls the permanent api per book', async () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={onClear} trash />, { wrapper })

    fireEvent.click(screen.getByText('library.permanentDelete'))
    expect(screen.getByText('library.batchPermanentDeleteConfirm')).toBeTruthy()
    expect(apiDelete).not.toHaveBeenCalled()

    const confirmButtons = screen.getAllByRole('button', { name: 'library.permanentDelete' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(apiDelete).toHaveBeenCalledTimes(2)
    expect(apiDelete).toHaveBeenCalledWith('/books/a/permanent')
  })
})
