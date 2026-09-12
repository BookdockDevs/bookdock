import { fireEvent, render, screen } from '@testing-library/react'

import MenuFlyout from '@/components/ui/MenuFlyout'

describe('MenuFlyout', () => {
  it('opens upward when the panel would overflow the viewport bottom', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })

    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.textContent?.includes('option')) {
        return { top: 220, right: 300, bottom: 400, left: 160, width: 140, height: 180, x: 160, y: 220, toJSON: () => ({}) }
      }
      return { top: 220, right: 300, bottom: 250, left: 150, width: 150, height: 30, x: 150, y: 220, toJSON: () => ({}) }
    })

    render(
      <MenuFlyout row={({ toggle }) => <button type="button" onClick={toggle}>status</button>}>
        {() => <button type="button">option</button>}
      </MenuFlyout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'status' }))

    expect(screen.getByText('option').parentElement?.parentElement).toHaveClass('bottom-0')
    getBoundingClientRect.mockRestore()
  })
})
