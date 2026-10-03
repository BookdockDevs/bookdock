import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Toast } from '@/components/ui/Toast'
import i18n from '@/i18n/i18n'
import { useToastStore } from '@/stores/toast.store'
import { useAuthStore } from '@/stores/auth.store'

describe('Toast', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useToastStore.getState().clearToasts()
  })

  it('renders distinct accessible surfaces for success and error notifications', () => {
    useToastStore.getState().addToast({ key: 'toast.bookUpdated' }, 'success')
    useToastStore.getState().addToast('Failed', 'error')

    render(<Toast />)

    expect(screen.getByRole('status')).toHaveTextContent('书籍信息已保存')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getAllByRole('button', { name: '关闭通知' })).toHaveLength(2)
  })

  it('dismisses a notification through its explicit close button', () => {
    useToastStore.getState().addToast('Saved', 'success')
    render(<Toast />)

    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('runs an action and removes the notification', () => {
    const onClick = vi.fn()
    useToastStore.getState().addToast('Failed', 'error', { action: { label: 'Retry', onClick } })
    render(<Toast />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })

  it('pauses independently for pointer and keyboard focus', () => {
    vi.useFakeTimers()
    try {
      useToastStore.getState().addToast('Saved', 'success')
      render(<Toast />)
      const card = screen.getByRole('status')
      fireEvent.pointerEnter(card)
      fireEvent.focus(screen.getByRole('button', { name: '关闭通知' }))
      fireEvent.pointerLeave(card)
      vi.advanceTimersByTime(10_000)
      expect(screen.getByText('Saved')).toBeInTheDocument()
      fireEvent.blur(card, { relatedTarget: document.body })
      vi.advanceTimersByTime(4_000)
      expect(useToastStore.getState().toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears visible and queued notifications when the account changes', () => {
    render(<Toast />)
    useToastStore.getState().addToast('Old account')
    useAuthStore.setState({ user: { id: 'another-user', username: 'Another', role: 'member' } })
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useToastStore.getState().queuedToasts).toHaveLength(0)
    useAuthStore.setState({ user: null })
  })

  it('clears an intersecting bottom action surface and recalibrates when it closes', async () => {
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.hasAttribute('data-toast-obstacle')
        ? new DOMRect(20, window.innerHeight - 80, 340, 40)
        : new DOMRect(16, 0, 360, 100)
    })
    try {
      useToastStore.getState().addToast('Failed', 'error')
      const { rerender } = render(<><div data-toast-obstacle="" /><Toast /></>)
      const host = screen.getByRole('alert').parentElement!
      expect(host.style.getPropertyValue('--bd-toast-clearance')).toBe('92px')
      rerender(<Toast />)
      await waitFor(() => expect(screen.getByRole('alert').parentElement!.style.getPropertyValue('--bd-toast-clearance')).toBe('0px'))
    } finally {
      geometry.mockRestore()
    }
  })

  it('does not move notifications for horizontally separate or hidden controls', () => {
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('hidden')) return new DOMRect(640, window.innerHeight - 80, 360, 0)
      return this.hasAttribute('data-toast-obstacle')
        ? new DOMRect(0, window.innerHeight - 80, 200, 40)
        : new DOMRect(640, 0, 360, 100)
    })
    try {
      useToastStore.getState().addToast('Saved', 'success')
      render(<><div data-toast-obstacle="" /><div data-toast-obstacle="" hidden /><Toast /></>)
      expect(screen.getByRole('status').parentElement!.style.getPropertyValue('--bd-toast-clearance')).toBe('0px')
    } finally {
      geometry.mockRestore()
    }
  })

  it('measures visible controls inside a transparent reader hover corridor', () => {
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset.testid === 'reader-pill') return new DOMRect(20, window.innerHeight - 70, 340, 40)
      if (this.hasAttribute('data-toast-obstacle')) return new DOMRect(20, window.innerHeight - 240, 340, 210)
      return new DOMRect(16, 0, 360, 100)
    })
    try {
      useToastStore.getState().addToast('Saved', 'success')
      render(<><div data-toast-obstacle="contents"><div data-testid="reader-pill" /></div><Toast /></>)
      expect(screen.getByRole('status').parentElement!.style.getPropertyValue('--bd-toast-clearance')).toBe('82px')
    } finally {
      geometry.mockRestore()
    }
  })
})
