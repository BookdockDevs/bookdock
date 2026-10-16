import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import ContentUpload from './ContentUpload'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

it.each([false, true])('offers image uploads without file attachments (compact=%s)', (compact) => {
  const onAdd = vi.fn()
  const { container } = render(<ContentUpload compact={compact} entries={[]} onAdd={onAdd} onRetry={vi.fn()} />)
  const inputs = container.querySelectorAll('input[type="file"]')
  expect(inputs).toHaveLength(1)
  expect(inputs[0]).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  expect(screen.queryByRole('button', { name: 'contentFiles.addAttachment' })).not.toBeInTheDocument()
  const file = new File(['image'], 'image.png', { type: 'image/png' })
  fireEvent.change(inputs[0], { target: { files: [file] } })
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(file, 'image')
})
