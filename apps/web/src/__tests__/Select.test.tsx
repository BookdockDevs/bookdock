import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Select from '@/components/ui/Select'

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
