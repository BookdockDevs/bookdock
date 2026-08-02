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
  useReaderState.setState({ selection: null })
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

  it('creates a separate idea annotation from the highlight bubble', async () => {
    annotationsData = [ANNOTATION]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'note', cfiRange: 'epubcfi(/6/4!/2)' })
  })

  it('creates a new idea from the idea overlay instead of editing the existing one', async () => {
    annotationsData = [{ ...ANNOTATION, type: 'note', note: '我的想法内容' }]
    setSelection(ANNOTATION.cfiRange)
    render(<SelectionToolbar bookId="b1" />)
    fireEvent.click(screen.getByTitle('annotation.writeNote'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: 'note', cfiRange: 'epubcfi(/6/4!/2)' })
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
})
