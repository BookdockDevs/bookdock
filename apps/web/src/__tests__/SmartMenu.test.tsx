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
})
