import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { useUiStore } from '@/stores/ui.store'
import { NoteEditorPopup } from '../features/reader/components/NoteEditorPopup'

const RECT = { left: 100, top: 300, width: 200, height: 40 }

function renderPopup(props?: Partial<Parameters<typeof NoteEditorPopup>[0]>) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <NoteEditorPopup rect={RECT} initialNote="" saving={false} onSave={onSave} onClose={onClose} {...props} />,
  )
  return { onSave, onClose, ...utils }
}

describe('NoteEditorPopup', () => {
  beforeEach(() => {
    useUiStore.setState({ readingMode: 'page' })
  })

  it('renders a compact editor above the selection in page mode', () => {
    const { container } = renderPopup()
    expect(screen.getByText('annotation.noteTitle')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'annotation.publish' })).toBeInTheDocument()
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('z-[70]')
    expect(parseFloat(root.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(root.style.top) + parseFloat(root.style.height)).toBeLessThan(RECT.top)
    expect(container.querySelector('.rotate-45')).toBeNull()
  })

  it('uses the same titled editor below the selection in scroll mode', () => {
    useUiStore.setState({ readingMode: 'scroll' })
    const { container } = renderPopup({ rect: { left: 100, top: 120, width: 200, height: 40 } })
    expect(screen.getByText('annotation.noteTitle')).toBeInTheDocument()
    expect(container.querySelector('.rounded-xl')).not.toBeNull()
    const root = container.firstElementChild as HTMLElement
    expect(parseFloat(root.style.top)).toBeGreaterThan(160)
  })

  it('flips the sheet above the selection when space below is tight in scroll mode', () => {
    useUiStore.setState({ readingMode: 'scroll' })
    const { container } = renderPopup({ rect: { left: 100, top: 600, width: 200, height: 40 } })
    const root = container.firstElementChild as HTMLElement
    expect(parseFloat(root.style.top) + parseFloat(root.style.height)).toBeLessThan(600)
  })

  it('stays inside the reading area beside an open sidebar', () => {
    const { container } = renderPopup({ geometry: {
      bounds: { left: 350, top: 40, width: 600, height: 680 },
      rects: [{ left: 400, top: 300, width: 250, height: 30 }], backward: false, focusX: 650,
    }, rect: { left: 400, top: 300, width: 250, height: 30 } })
    const root = container.firstElementChild as HTMLElement
    expect(parseFloat(root.style.left)).toBeGreaterThanOrEqual(350)
    expect(parseFloat(root.style.left) + parseFloat(root.style.width)).toBeLessThanOrEqual(950)
  })

  it('grows for a long draft and limits the editor height', () => {
    const { container } = renderPopup()
    const root = container.firstElementChild as HTMLElement
    const input = screen.getByPlaceholderText('annotation.notePlaceholder')
    const initialHeight = parseFloat(root.style.height)
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 900 })
    fireEvent.change(input, { target: { value: 'Long note '.repeat(100) } })
    expect(parseFloat(root.style.height)).toBeGreaterThan(initialHeight)
    expect(parseFloat(root.style.height)).toBeLessThanOrEqual(380)
    expect(input.style.flex).toBe('')
  })

  it('prefills the draft and submits the trimmed note on publish', () => {
    const { onSave } = renderPopup({ initialNote: 'old note' })
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    expect(textarea).toHaveValue('old note')
    fireEvent.change(textarea, { target: { value: '  新的想法  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'annotation.publish' }))
    expect(onSave).toHaveBeenCalledWith('新的想法')
  })

  it('submits with Ctrl+Enter', () => {
    const { onSave } = renderPopup()
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    fireEvent.change(textarea, { target: { value: 'note' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('note')
  })

  it('closes on Escape and outside mousedown, but not on inside clicks', () => {
    const { onClose } = renderPopup()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByPlaceholderText('annotation.notePlaceholder'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('disables the publish button while saving', () => {
    renderPopup({ saving: true })
    expect(screen.getByRole('button', { name: 'annotation.publish' })).toBeDisabled()
  })

  it('disables the publish button while the draft is blank', () => {
    renderPopup()
    const publish = screen.getByRole('button', { name: 'annotation.publish' })
    expect(publish).toBeDisabled()
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    fireEvent.change(textarea, { target: { value: '   ' } })
    expect(publish).toBeDisabled()
    fireEvent.change(textarea, { target: { value: '想法' } })
    expect(publish).toBeEnabled()
  })

  it('ignores Ctrl+Enter when the draft is blank', () => {
    const { onSave } = renderPopup()
    const textarea = screen.getByPlaceholderText('annotation.notePlaceholder')
    fireEvent.change(textarea, { target: { value: '  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })
  it('shows scope only for B and submits the selected scope without clearing a failed draft', () => {
    const onSaveVisibility = vi.fn()
    renderPopup({ initialNote: 'retained draft', initialVisibility: 'shared', visibilityEligible: true, sourceReadable: true, onSaveVisibility })
    const scope = screen.getByRole('combobox')
    expect(scope).toHaveValue('shared')
    fireEvent.change(scope, { target: { value: 'private' } })
    fireEvent.click(screen.getByRole('button', { name: 'annotation.publish' }))
    expect(onSaveVisibility).toHaveBeenCalledWith('retained draft', 'private')
    expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toHaveValue('retained draft')
  })

  it('does not silently downgrade public scope when its source becomes unavailable', () => {
    const onSaveVisibility = vi.fn()
    renderPopup({ initialNote: 'draft', initialVisibility: 'shared', visibilityEligible: true, sourceReadable: false, onSaveVisibility })
    expect(screen.getByRole('combobox')).toHaveValue('shared')
    fireEvent.click(screen.getByRole('button', { name: 'annotation.publish' }))
    expect(onSaveVisibility).toHaveBeenCalledWith('draft', 'shared')
  })

  it('hides scope outside B and prevents dismissal while publication is pending', () => {
    const { onClose } = renderPopup({ initialNote: 'pending draft', saving: true })
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

})
