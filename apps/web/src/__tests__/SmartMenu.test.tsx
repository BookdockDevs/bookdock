import { fireEvent, render, screen } from '@testing-library/react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useContextMenu } from '@/features/library/components/use-context-menu'

function SmartMenuHarness() {
  const menu = useContextMenu()

  return (
    <>
      <button ref={menu.btnRef} type="button" onClick={() => menu.toggleFromButton()}>
        toggle
      </button>
      <SmartMenu
        triggerRef={menu.btnRef}
        innerRef={menu.menuRef}
        position={menu.position(120, 80)}
        onClose={menu.close}
      >
        menu content
      </SmartMenu>
    </>
  )
}

describe('SmartMenu', () => {
  it('toggles closed when its trigger is clicked again', () => {
    render(<SmartMenuHarness />)

    const trigger = screen.getByRole('button', { name: 'toggle' })
    fireEvent.click(trigger)
    expect(screen.getByText('menu content')).toBeInTheDocument()

    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByText('menu content')).toBeNull()
  })

  it('stops pointerdown propagation so parent draggable listeners are not triggered', () => {
    const parentPointerDown = vi.fn()

    function NestedHarness() {
      const menu = useContextMenu()
      return (
        <div onPointerDown={parentPointerDown}>
          <button ref={menu.btnRef} type="button" onClick={() => menu.toggleFromButton()}>
            toggle
          </button>
          <SmartMenu
            triggerRef={menu.btnRef}
            innerRef={menu.menuRef}
            position={{ left: 10, top: 10, dir: 'down' }}
            onClose={menu.close}
          >
            <button type="button">menu item</button>
          </SmartMenu>
        </div>
      )
    }

    render(<NestedHarness />)
    const trigger = screen.getByRole('button', { name: 'toggle' })
    fireEvent.click(trigger)

    const menuItem = screen.getByRole('button', { name: 'menu item' })
    fireEvent.pointerDown(menuItem)

    expect(parentPointerDown).not.toHaveBeenCalled()
  })
})
