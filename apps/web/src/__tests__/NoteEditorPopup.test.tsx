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

  it('renders the WeChat-style bubble with title and adaptive arrow in page mode', () => {
    const { container } = renderPopup()
    expect(screen.getByText('annotation.noteTitle')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'annotation.publish' })).toBeInTheDocument()
    // jsdom viewport is 1024x768 — the bubble pops out to the right of the selection
    const root = container.firstElementChild as HTMLElement
    expect(root.style.left).toBe('314px') // rect.right + gap
    expect(root.style.top).toBe('150px') // centered on selection
    const arrow = container.querySelector('.rotate-45') as HTMLElement
    expect(arrow).not.toBeNull()
    expect(arrow.style.top).toBe('163px') // selection center 320 - top 150 - arrow half 7
  })

  it('renders the dark sheet below the selection without an arrow in scroll mode', () => {
    useUiStore.setState({ readingMode: 'scroll' })
    const { container } = renderPopup({ rect: { left: 100, top: 120, width: 200, height: 40 } })
    expect(screen.queryByText('annotation.noteTitle')).toBeNull()
    expect(container.querySelector('.rotate-45')).toBeNull()
    expect(container.querySelector('.bg-stone-700')).not.toBeNull()
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe('174px') // rect.bottom + gap
  })

  it('flips the sheet above the selection when space below is tight in scroll mode', () => {
    useUiStore.setState({ readingMode: 'scroll' })
    const { container } = renderPopup({ rect: { left: 100, top: 600, width: 200, height: 40 } })
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe('286px') // rect.top - gap - sheet height 300
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
})
