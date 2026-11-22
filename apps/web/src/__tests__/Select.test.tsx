import { fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import Select from '@/components/ui/Select'
import SmartMenu from '@/components/ui/SmartMenu'
import type { MenuAnchor } from '@/lib/menu-anchor'

function NestedSelect({ onValueChange }: { onValueChange: (value: string) => void }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <button type="button" onClick={(event) => setAnchor({ kind: 'element', el: event.currentTarget, placement: 'below' })}>Categories</button>
      <SmartMenu innerRef={menuRef} anchor={anchor} size={{ width: 200, height: 100 }} onClose={() => setAnchor(null)}>
        <Select
          aria-label="Parent category"
          value=""
          onValueChange={onValueChange}
          options={[{ value: '', label: 'Root' }, { value: 'history', label: 'History' }]}
        />
      </SmartMenu>
    </>
  )
}

describe('Select', () => {
  it('renders SmartMenu options and emits onValueChange on click', () => {
    const onValueChange = vi.fn()
    render(
      <Select
        aria-label="所属上级"
        value="a"
        onValueChange={onValueChange}
        options={[
          { value: 'a', label: '根目录' },
          { value: 'b', label: '历史' },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: '所属上级' })
    expect(trigger).toHaveTextContent('根目录')

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('listbox', { name: '所属上级' })).getByRole('option', { name: '历史' }))
    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('supports native fallback when children are passed', () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="排序" value="a" onChange={(e) => onChange(e.target.value)}>
        <option value="a">选项 A</option>
        <option value="b">选项 B</option>
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: '排序' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('keeps the parent menu open when a portaled option receives a pointer event', () => {
    const onValueChange = vi.fn()
    render(<NestedSelect onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    const trigger = screen.getByRole('button', { name: 'Parent category' })
    fireEvent.click(trigger)
    const option = screen.getByRole('option', { name: 'History' })
    fireEvent.pointerDown(option)
    fireEvent.mouseDown(option)
    fireEvent.click(option)

    expect(onValueChange).toHaveBeenCalledWith('history')
    expect(trigger).toHaveFocus()
  })

  it('opens with the keyboard, skips disabled options and restores focus after selection', () => {
    const onValueChange = vi.fn()
    render(
      <Select
        aria-label="Parent category"
        value="root"
        onValueChange={onValueChange}
        options={[
          { value: 'root', label: 'Root' },
          { value: 'disabled', label: 'Unavailable', disabled: true },
          { value: 'history', label: 'History' },
        ]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Parent category' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const listbox = screen.getByRole('listbox', { name: 'Parent category' })
    expect(listbox).toHaveFocus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(listbox).toHaveAttribute('aria-activedescendant', within(listbox).getByRole('option', { name: 'History' }).id)
    fireEvent.keyDown(listbox, { key: 'Enter' })

    expect(onValueChange).toHaveBeenCalledWith('history')
    expect(trigger).toHaveFocus()
  })

  it('respects disabled state', () => {
    render(
      <Select
        aria-label="所属上级"
        disabled
        value="a"
        options={[{ value: 'a', label: '根目录' }]}
      />,
    )

    expect(screen.getByRole('button', { name: '所属上级' })).toBeDisabled()
  })
})
