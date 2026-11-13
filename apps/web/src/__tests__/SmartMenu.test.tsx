import { act, fireEvent, render, screen } from '@testing-library/react'
import { Profiler, useCallback, useEffect, useRef } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'

interface RectInput {
  left: number
  top: number
  width: number
  height: number
}

function stubRect(el: Element, rect: RectInput) {
  el.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  }) as DOMRect
}

/** Lets the reconciliation loop run: it is what commits the placement. */
async function settle(frames = 3) {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
  }
}

function menuElement() {
  return screen.getByText('menu content').closest('[data-smart-menu]') as HTMLElement
}

function ToggleHarness() {
  const menu = useMenuAnchor()

  return (
    <>
      <button ref={menu.btnRef} type="button" onClick={() => menu.toggleFromButton()}>
        toggle
      </button>
      <SmartMenu anchor={menu.anchor} size={{ width: 120, height: 80 }} innerRef={menu.menuRef} onClose={menu.close}>
        menu content
      </SmartMenu>
    </>
  )
}

function AnchoredHarness({ showAnchor }: { showAnchor: boolean }) {
  const menu = useMenuAnchor()
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const rectRef = useRef<RectInput>({ left: 100, top: 100, width: 40, height: 40 })
  const openedRef = useRef(false)

  const attach = useCallback((node: HTMLButtonElement | null) => {
    anchorRef.current = node
    if (node) stubRect(node, rectRef.current)
  }, [])

  useEffect(() => {
    if (!openedRef.current && anchorRef.current) {
      openedRef.current = true
      menu.openAtElement(anchorRef.current)
    }
  }, [menu])

  return (
    <>
      {showAnchor && (
        <button
          ref={attach}
          type="button"
          onClick={() => {
            // The layout moves with no scroll and no resize - only the rect.
            rectRef.current = { ...rectRef.current, top: 300 }
            if (anchorRef.current) stubRect(anchorRef.current, rectRef.current)
          }}
        >
          anchor
        </button>
      )}
      {menu.open && (
        <SmartMenu anchor={menu.anchor} size={{ width: 120, height: 80 }} innerRef={menu.menuRef} onClose={menu.close}>
          menu content
        </SmartMenu>
      )}
    </>
  )
}

describe('SmartMenu', () => {
  it('toggles closed when its trigger is clicked again', () => {
    render(<ToggleHarness />)

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
      const menu = useMenuAnchor()
      return (
        <div onPointerDown={parentPointerDown}>
          <button ref={menu.btnRef} type="button" onClick={() => menu.toggleFromButton()}>
            toggle
          </button>
          <SmartMenu anchor={menu.anchor} size={{ width: 120, height: 80 }} innerRef={menu.menuRef} onClose={menu.close}>
            <button type="button">menu item</button>
          </SmartMenu>
        </div>
      )
    }

    render(<NestedHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))

    fireEvent.pointerDown(screen.getByRole('button', { name: 'menu item' }))

    expect(parentPointerDown).not.toHaveBeenCalled()
  })

  it('re-derives its position when the anchor moves without any scroll event', async () => {
    const onRender = vi.fn()
    render(<Profiler id="menu" onRender={onRender}><AnchoredHarness showAnchor /></Profiler>)
    await settle()

    expect(menuElement().style.translate).toBe('140px 148px')
    onRender.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'anchor' }))
    })
    await settle()

    expect(menuElement().style.translate).toBe('140px 348px')
    expect(onRender).not.toHaveBeenCalled()
  })

  it('closes when the anchor is removed while nothing scrolls or resizes', async () => {
    const { rerender } = render(<AnchoredHarness showAnchor />)
    await settle()
    expect(screen.getByText('menu content')).toBeInTheDocument()

    rerender(<AnchoredHarness showAnchor={false} />)
    await settle()

    expect(screen.queryByText('menu content')).toBeNull()
  })
})
