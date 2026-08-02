import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UploadSheet from '../features/library/components/UploadSheet'

vi.mock('../features/library/hooks', () => ({
  useUploadBook: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('UploadSheet', () => {
  it('clicking drop zone triggers hidden file input', () => {
    render(<UploadSheet open onClose={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    const dropZone = screen.getByText('library.uploadHint').parentElement
    fireEvent.click(dropZone!)
    expect(clickSpy).toHaveBeenCalled()
  })
})
