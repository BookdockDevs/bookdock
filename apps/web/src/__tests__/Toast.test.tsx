import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Toast } from '@/components/ui/Toast'
import i18n from '@/i18n/i18n'
import { useToastStore } from '@/stores/toast.store'

describe('Toast', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useToastStore.getState().clearToasts()
  })

  it('renders distinct accessible surfaces for success and error notifications', () => {
    useToastStore.getState().addToast({ key: 'toast.bookUpdated' }, 'success')
    useToastStore.getState().addToast('Failed', 'error')

    render(<Toast />)

    expect(screen.getByRole('status')).toHaveTextContent('书籍已更新')
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
})
