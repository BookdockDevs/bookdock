import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'

import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { DialogLayoutContext } from '@/components/ui/dialog-layout-context'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

function FocusHarness() {
  const [value, setValue] = useState('')

  return (
    <Modal title="Test modal" onClose={() => undefined}>
      <input aria-label="first" value={value} onChange={(event) => setValue(event.target.value)} />
      <input aria-label="second" />
    </Modal>
  )
}

function NestedMenuHarness() {
  const [modalOpen, setModalOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  if (!modalOpen) return null

  return (
    <Modal title="Test modal" onClose={() => setModalOpen(false)}>
      <button type="button" onClick={() => setMenuOpen(true)}>Open menu</button>
      {menuOpen && (
        <SmartMenu
          innerRef={menuRef}
          position={{ left: 0, top: 0, dir: 'down' }}
          onClose={() => setMenuOpen(false)}
        >
          menu item
        </SmartMenu>
      )}
    </Modal>
  )
}

describe('Modal', () => {
  it('leaves the modal open when Escape originates from an editor portal', () => {
    const close = vi.fn()
    render(<Modal title="Test modal" onClose={close}>Content</Modal>)
    const portal = document.createElement('div')
    portal.className = 'mdxeditor-popup-container'
    const option = document.createElement('button')
    portal.append(option)
    document.body.append(portal)
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    portal.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('keeps the reader inset when portaled to the document body', () => {
    const { rerender } = render(
      <DialogLayoutContext.Provider value={344}>
        <Modal title="Test modal" onClose={() => undefined}>Content</Modal>
      </DialogLayoutContext.Provider>,
    )

    const backdrop = screen.getByRole('dialog').parentElement
    expect(backdrop).toHaveStyle({ '--reader-dialog-inset': '344px' })
    expect(backdrop?.className).toContain('left-[var(--reader-dialog-inset)]')

    rerender(
      <DialogLayoutContext.Provider value={0}>
        <Modal title="Test modal" onClose={() => undefined}>Content</Modal>
      </DialogLayoutContext.Provider>,
    )
    expect(backdrop).toHaveStyle({ '--reader-dialog-inset': '0px' })
  })

  it('supports a centered headerless reader detail shell', () => {
    render(
      <Modal title="Book title" onClose={() => undefined} variant="reader" size="idea" centered hideHeader contentClassName="!p-0">
        Content
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toHaveClass('max-w-[420px]', 'rounded-2xl')
    expect(screen.getByRole('heading', { name: 'Book title' })).toHaveClass('sr-only')
    expect(screen.getByRole('dialog').parentElement).toHaveClass('items-center', 'p-4')
    expect(screen.queryByRole('button', { name: 'library.close' })).not.toBeInTheDocument()
  })

  it('does not steal focus after a controlled form rerenders', () => {
    render(<FocusHarness />)

    const first = screen.getByRole('textbox', { name: 'first' })
    const second = screen.getByRole('textbox', { name: 'second' })
    second.focus()

    fireEvent.change(first, { target: { value: 'updated' } })

    expect(document.activeElement).toBe(second)
  })

  it('closes a nested smart menu without closing the modal', () => {
    render(<NestedMenuHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByText('menu item')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })

    expect(screen.queryByText('menu item')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
