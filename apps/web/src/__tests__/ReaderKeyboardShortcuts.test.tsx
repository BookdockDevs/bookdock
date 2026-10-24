import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPut } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import ReaderKeyboardShortcuts from '../features/reader/components/ReaderKeyboardShortcuts'

vi.mock('@/api/client', () => ({ apiPut: vi.fn().mockResolvedValue({ data: {} }) }))

describe('ReaderKeyboardShortcuts', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: { id: 'alice', username: 'alice', role: 'user' } })
    vi.mocked(apiPut).mockClear()
  })
  afterEach(() => useAuthStore.setState({ user: null }))

  it('persists a recorded binding after confirming with the save button and rejects conflicts', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-toc'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { readerShortcuts: expect.stringContaining('"key":"k"') }))

    fireEvent.click(screen.getByTestId('shortcut-binding-notes'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-notes'))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(apiPut).toHaveBeenCalledTimes(1)
  })

  it('shows the six added commands in the current list and records Home/End', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    for (const id of ['historyBack', 'historyForward', 'tts', 'autoReading', 'chapterStart', 'chapterEnd']) {
      expect(screen.getByTestId(`shortcut-row-${id}`)).toBeTruthy()
    }

    fireEvent.click(screen.getByTestId('shortcut-binding-chapterStart'))
    fireEvent.keyDown(document, { key: 'Home', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-chapterStart'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { readerShortcuts: expect.stringContaining('"key":"Home"') }))
  })

  it('records Shift+/ as the explicit slash binding and closes on the reader toggle event', async () => {
    const onClose = vi.fn()
    render(<ReaderKeyboardShortcuts onClose={onClose} />)
    expect(screen.getByTestId('shortcut-binding-shortcutsMenu').textContent).toContain('Shift')
    expect(screen.getByTestId('shortcut-binding-shortcutsMenu').textContent).toContain('/')

    fireEvent.click(screen.getByTestId('shortcut-binding-shortcutsMenu'))
    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-shortcutsMenu'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { readerShortcuts: expect.stringContaining('"key":"/"') }))

    window.dispatchEvent(new Event('bd-reader-shortcuts-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('allows canceling an in-flight recording without saving', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-cancel-toc'))
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('clears a command and saves the change', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-clear-toc'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/settings', { readerShortcuts: expect.stringContaining('"toc":null') }))
  })

  it('rejects restoring a default that conflicts with another command', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)

    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-toc'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('shortcut-binding-notes'))
    fireEvent.keyDown(document, { key: 't', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-notes'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('shortcut-default-toc'))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(apiPut).toHaveBeenCalledTimes(2)
  })

  it('clears stale shortcut retries after a newer server save succeeds', async () => {
    localStorage.setItem('bd-settings-pending', JSON.stringify({ userId: 'alice', payload: { readerShortcuts: 'old', readingConfig: 'keep' } }))
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-clear-toc'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bd-settings-pending')!).payload).toEqual({ readingConfig: 'keep' }))
  })

  it('queues a failed save for the existing settings retry path', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new Error('offline'))
    const retry = vi.fn()
    window.addEventListener('bd-settings-pending', retry)
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-clear-toc'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bd-settings-pending')!).payload.readerShortcuts).toContain('"toc":null'))
    expect(retry).toHaveBeenCalledOnce()
    window.removeEventListener('bd-settings-pending', retry)
  })
})
