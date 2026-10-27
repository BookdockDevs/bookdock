import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LeaveEditorDialog from './LeaveEditorDialog'

describe('leave editor dialog', () => {
  it('places all three choices together in the dialog footer', () => {
    render(<LeaveEditorDialog saving={false} preserve={vi.fn(async () => true)} discard={vi.fn(async () => true)} onLeave={vi.fn()} onClose={vi.fn()} />)
    const discard = screen.getByRole('button', { name: '放弃草稿并离开' })
    const footer = discard.parentElement
    expect(footer).toContainElement(screen.getByRole('button', { name: '继续编辑' }))
    expect(footer).toContainElement(screen.getByRole('button', { name: '保留草稿并离开' }))
  })
  it('continues editing without changing the draft', () => {
    const close = vi.fn(); const preserve = vi.fn(async () => true); const discard = vi.fn(async () => true)
    render(<LeaveEditorDialog saving={false} preserve={preserve} discard={discard} onLeave={vi.fn()} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(close).toHaveBeenCalledOnce()
    expect(preserve).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled()
  })

  it('leaves only after successful explicit discard', async () => {
    const leave = vi.fn(); const discard = vi.fn(async () => true)
    render(<LeaveEditorDialog saving={false} preserve={vi.fn(async () => true)} discard={discard} onLeave={leave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿并离开' }))
    await waitFor(() => expect(leave).toHaveBeenCalledOnce())
    expect(discard).toHaveBeenCalledOnce()
  })

  it('stays open when local preservation fails', async () => {
    const leave = vi.fn()
    render(<LeaveEditorDialog saving={false} preserve={vi.fn(async () => false)} discard={vi.fn(async () => true)} onLeave={leave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '保留草稿并离开' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(leave).not.toHaveBeenCalled()
  })

  it('prevents discarding while the draft is being preserved', async () => {
    let resolve!: (result: boolean) => void
    const discard = vi.fn(async () => true)
    const preserve = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
    render(<LeaveEditorDialog saving={false} preserve={preserve} discard={discard} onLeave={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '保留草稿并离开' }))
    expect(screen.getByRole('button', { name: '放弃草稿并离开' })).toBeDisabled()
    expect(discard).not.toHaveBeenCalled()
    await act(async () => resolve(true))
    expect(preserve).toHaveBeenCalledOnce()
  })
})
