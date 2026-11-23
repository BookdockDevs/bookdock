import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth.store'
import ReaderKeyboardShortcuts from '../features/reader/components/ReaderKeyboardShortcuts'
import { LocalReaderContext } from '../features/reading-data/reader-source-context'
import type { LocalReaderSession } from '../features/reading-data/reader-source-context'

const saveShortcuts = vi.fn((event: Event) => (event as CustomEvent).detail)

describe('ReaderKeyboardShortcuts', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: { id: 'alice', username: 'alice', role: 'user' } })
    saveShortcuts.mockClear()
    window.addEventListener('bd-settings-shortcuts-save', saveShortcuts)
  })
  afterEach(() => {
    window.removeEventListener('bd-settings-shortcuts-save', saveShortcuts)
    useAuthStore.setState({ user: null })
  })

  it('keeps local bindings out of account settings and remote retry payloads', () => {
    render(<LocalReaderContext.Provider value={{ namespace: 'local:test' } as LocalReaderSession}><ReaderKeyboardShortcuts onBack={vi.fn()} /></LocalReaderContext.Provider>)
    fireEvent.click(screen.getByTestId('shortcut-clear-toc'))
    expect(saveShortcuts).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('bd-reader-shortcuts:local-vault:device')!).toc).toBeNull()
    expect(localStorage.getItem('bd-reader-shortcuts:alice')).toBeNull()
  })

  it('persists a recorded binding after confirming with the save button and rejects conflicts', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-toc'))
    await waitFor(() => expect(saveShortcuts).toHaveReturnedWith({ userId: 'alice', readerShortcuts: expect.stringContaining('"key":"k"') }))

    fireEvent.click(screen.getByTestId('shortcut-binding-notes'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-notes'))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(saveShortcuts).toHaveBeenCalledTimes(1)
  })

  it('shows the six added commands in the current list and records Home/End', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    for (const id of ['historyBack', 'historyForward', 'tts', 'autoReading', 'chapterStart', 'chapterEnd']) {
      expect(screen.getByTestId(`shortcut-row-${id}`)).toBeTruthy()
    }

    fireEvent.click(screen.getByTestId('shortcut-binding-chapterStart'))
    fireEvent.keyDown(document, { key: 'Home', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-chapterStart'))
    await waitFor(() => expect(saveShortcuts).toHaveReturnedWith({ userId: 'alice', readerShortcuts: expect.stringContaining('"key":"Home"') }))
  })

  it('records Shift+/ as the explicit slash binding and closes on the reader toggle event', async () => {
    const onClose = vi.fn()
    render(<ReaderKeyboardShortcuts onClose={onClose} />)
    expect(screen.getByTestId('shortcut-binding-shortcutsMenu').textContent).toContain('Shift')
    expect(screen.getByTestId('shortcut-binding-shortcutsMenu').textContent).toContain('/')

    fireEvent.click(screen.getByTestId('shortcut-binding-shortcutsMenu'))
    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-shortcutsMenu'))
    await waitFor(() => expect(saveShortcuts).toHaveReturnedWith({ userId: 'alice', readerShortcuts: expect.stringContaining('"key":"/"') }))

    window.dispatchEvent(new Event('bd-reader-shortcuts-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('allows canceling an in-flight recording without saving', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-cancel-toc'))
    expect(saveShortcuts).not.toHaveBeenCalled()
  })

  it('clears a command and saves the change', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('shortcut-clear-toc'))
    await waitFor(() => expect(saveShortcuts).toHaveReturnedWith({ userId: 'alice', readerShortcuts: expect.stringContaining('"toc":null') }))
  })

  it('rejects restoring a default that conflicts with another command', async () => {
    render(<ReaderKeyboardShortcuts onBack={vi.fn()} />)

    fireEvent.click(screen.getByTestId('shortcut-binding-toc'))
    fireEvent.keyDown(document, { key: 'k', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-toc'))
    await waitFor(() => expect(saveShortcuts).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('shortcut-binding-notes'))
    fireEvent.keyDown(document, { key: 't', cancelable: true })
    fireEvent.click(screen.getByTestId('shortcut-save-notes'))
    await waitFor(() => expect(saveShortcuts).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('shortcut-default-toc'))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(saveShortcuts).toHaveBeenCalledTimes(2)
  })

})
