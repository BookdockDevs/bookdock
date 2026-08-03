import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

import type { AnnotationRes } from '@bookdock/shared'

import { useReaderState } from '../features/reader/state/reader-state'
import { SelectionToolbar } from '../features/reader/components/SelectionToolbar'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()
let annotationsData: AnnotationRes[] = []

vi.mock('../features/reader/hooks/useAnnotations', () => ({
  useAnnotations: () => ({ data: { data: annotationsData } }),
  useCreateAnnotation: () => ({ mutateAsync: createMutate }),
  useUpdateAnnotation: () => ({ mutateAsync: updateMutate, isPending: false }),
  useDeleteAnnotation: () => ({ mutateAsync: deleteMutate }),
}))

const RECT = { left: 100, top: 300, width: 200, height: 40 }

const ANNOTATION: AnnotationRes = {
  id: 'a1',
  bookId: 'b1',
  cfiRange: 'epubcfi(/6/4!/2)',
  cfiAnchor: null,
  type: 'highlight',
  color: 'yellow',
  style: 'underline',
  text: '划线文本',
  note: null,
  chapter: null,
  createdAt: 0,
  updatedAt: 0,
}

function setSelection(cfiRange = 'epubcfi(/6/4!/2)') {
  act(() => useReaderState.setState({ selection: { cfiRange, text: '划线文本', rect: RECT } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  annotationsData = []
  createMutate.mockResolvedValue({ data: ANNOTATION })
  updateMutate.mockResolvedValue({})
  deleteMutate.mockResolvedValue({})
})

afterEach(() => {
  useReaderState.setState({ selection: null, noteEditorRange: null })
})

describe('SelectionToolbar', () => {
  it('shows highlight actions for a fresh selection', async () => {
    setSelection()
    render(<SelectionToolbar bookId="b1" />)
    expect(screen.getByTitle('annotation.copy')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.drawHighlight')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.writeNote')).toBeInTheDocument()
    expect(screen.getByTitle('reader.search')).toBeInTheDocument()
    expect(screen.queryByTitle('annotation.deleteHighlight')).toBeNull()
    expect(screen.queryByTitle('annotation.colorRed')).toBeNull()

    fireEvent.click(screen.getByTitle('annotation.drawHighlight'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'highlight', cfiRange: 'epubcfi(/6/4!/2)' })
  })

  it('transforms into the annotation state after highlighting', async () => {
    setSelection()
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.drawHighlight'))
    await waitFor(() => expect(screen.getByTitle('annotation.deleteHighlight')).toBeInTheDocument())
    expect(screen.getByTitle('annotation.colorRed')).toBeInTheDocument()
  })

  it('reuses the same bubble when clicking an existing annotation', () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    expect(screen.getByTitle('annotation.copy')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.deleteHighlight')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.writeNote')).toBeInTheDocument()
    expect(screen.getByTitle('reader.search')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.colorRed')).toBeInTheDocument()
    expect(screen.queryByText('划线文本')).toBeNull()
  })

  it('restyles and deletes an existing annotation', async () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.colorRed'))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'a1', body: { color: 'red' } }))
    fireEvent.click(screen.getByTitle('annotation.deleteHighlight'))
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(useReaderState.getState().selection).toBeNull())
  })

  it('restores the remembered color when switching styles', async () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    // Pick red for the current underline style, then switch to squiggly and back
    fireEvent.click(screen.getByTitle('annotation.colorRed'))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'a1', body: { color: 'red' } }))
    fireEvent.click(screen.getByTitle('annotation.styleSquiggly'))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'a1', body: { style: 'squiggly', color: 'yellow' } }))
    fireEvent.click(screen.getByTitle('annotation.styleUnderline'))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'a1', body: { style: 'underline', color: 'red' } }))
  })

  it('opens the note editor from the annotation bubble', async () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument())
  })

  it('shows the idea overlay and opens the detail level when clicking an idea', () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    // level 1: quote card + idea entry preview
    expect(screen.getByText('划线文本')).toBeInTheDocument()
    expect(screen.getByText('我的想法内容')).toBeInTheDocument()
    expect(screen.getByTitle('annotation.drawHighlight')).toBeInTheDocument()
    expect(screen.queryByTitle('annotation.styleSquiggly')).toBeNull()
    expect(screen.queryByTitle('annotation.deleteHighlight')).toBeNull()
    // clicking the entry switches to the detail level
    fireEvent.click(screen.getByText('我的想法内容'))
    expect(screen.getByTitle('annotation.editNote')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('annotation.editNote'))
    expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument()
  })

  it('copies the note content from the idea detail', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByText('我的想法内容'))
    fireEvent.click(screen.getByTitle('annotation.copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('我的想法内容'))
  })

  it('creates a highlight alongside the idea instead of converting it', async () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.drawHighlight'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'highlight', cfiRange: 'epubcfi(/6/4!/2)' })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('prefers the highlight bubble when a range has both a highlight and an idea', () => {
    annotationsData = [
      ANNOTATION,
      { ...ANNOTATION, id: 'a2', type: 'note', note: '我的想法内容' },
    ]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    expect(screen.getByTitle('annotation.deleteHighlight')).toBeInTheDocument()
    expect(screen.queryByText('我的想法内容')).toBeNull()
  })

  it('creates a separate idea annotation from the highlight bubble only on publish', async () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument())
    // opening the editor must not persist anything yet
    expect(createMutate).not.toHaveBeenCalled()
    // the editor marks its range so the reader can draw the dashed underline
    expect(useReaderState.getState().noteEditorRange).toBe('epubcfi(/6/4!/2)')
    fireEvent.change(screen.getByPlaceholderText('annotation.notePlaceholder'), { target: { value: '我的想法' } })
    fireEvent.click(screen.getByRole('button', { name: 'annotation.publish' }))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'note', cfiRange: 'epubcfi(/6/4!/2)', note: '我的想法' })
    expect(updateMutate).not.toHaveBeenCalled()
    expect(useReaderState.getState().noteEditorRange).toBeNull()
  })

  it('creates a new idea from the idea overlay instead of editing the existing one', async () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('annotation.notePlaceholder'), { target: { value: '再补一条' } })
    fireEvent.click(screen.getByRole('button', { name: 'annotation.publish' }))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'note', cfiRange: 'epubcfi(/6/4!/2)', note: '再补一条' })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('keeps the idea overlay open after copying the quote', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('划线文本'))
    expect(screen.getByText('我的想法内容')).toBeInTheDocument()
  })

  it('copies the selected text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    setSelection()
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('划线文本'))
  })

  it('discards a brand-new idea on cancel without persisting anything', async () => {
    setSelection()
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument())
    expect(useReaderState.getState().noteEditorRange).toBe('epubcfi(/6/4!/2)')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // the draft was never sent, so cancel needs no delete either
    expect(createMutate).not.toHaveBeenCalled()
    expect(deleteMutate).not.toHaveBeenCalled()
    // cancelling must dismiss the toolbar too, not just the editor
    await waitFor(() => expect(useReaderState.getState().selection).toBeNull())
    expect(useReaderState.getState().noteEditorRange).toBeNull()
  })

  it('keeps an existing idea when its editor is cancelled', async () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '已有想法' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByText('已有想法'))
    fireEvent.click(screen.getByTitle('annotation.editNote'))
    await waitFor(() => expect(screen.getByPlaceholderText('annotation.notePlaceholder')).toBeInTheDocument())
    expect(useReaderState.getState().noteEditorRange).toBe('epubcfi(/6/4!/2)')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('annotation.notePlaceholder')).toBeNull())
    expect(deleteMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(useReaderState.getState().selection).toBeNull())
    expect(useReaderState.getState().noteEditorRange).toBeNull()
  })

  it('drops back to the idea list when other ideas remain at the range after deletion', async () => {
    const note1 = { ...ANNOTATION, id: 'n1', type: 'note' as const, note: '想法一' }
    const note2 = { ...ANNOTATION, id: 'n2', type: 'note' as const, note: '想法二' }
    annotationsData = [note1, note2]
    setSelection(ANNOTATION.cfiRange)
    const { rerender } = render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByText('想法一'))
    expect(screen.getByTitle('annotation.editNote')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('annotation.deleteAnnotation'))
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('n1'))
    // Simulate the annotations refetch after deletion: the detail entry is gone
    annotationsData = [note2]
    rerender(<SelectionToolbar bookId="b1" />)
    await waitFor(() => expect(screen.queryByTitle('annotation.editNote')).toBeNull())
    expect(screen.getByText('想法二')).toBeInTheDocument()
    expect(useReaderState.getState().selection).not.toBeNull()
  })

  it('closes the overlay when the last idea at the range is deleted', async () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '唯一想法' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByText('唯一想法'))
    fireEvent.click(screen.getByTitle('annotation.deleteAnnotation'))
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(useReaderState.getState().selection).toBeNull())
  })
})
