import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../hooks/useEditorAccess', () => ({ useEditorAccess: () => 'allowed' }))
vi.mock('../hooks/useLocalEditorDraft', () => ({ useLocalEditorDraft: () => ({ ready: true, failure: null, status: 'saved', candidate: null, clear: draftClear }) }))
vi.mock('../hooks/useDraftNavigationGuard', () => ({ useDraftNavigationGuard: () => ({ back: vi.fn(), blocked: false }) }))
import type { DragEndEvent } from '@dnd-kit/core'

import type { EditorEpubLoadRes, EditorTxtSaveRes } from '@bookdock/shared'

import i18n from '@/i18n/i18n'
import { useUiStore } from '@/stores/ui.store'
import { useToastStore } from '@/stores/toast.store'

const dragHandlers = vi.hoisted(() => ({ end: null as ((event: DragEndEvent) => void) | null }))
const draftClear = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: import('react').ComponentProps<typeof actual.DndContext>) => {
      dragHandlers.end = props.onDragEnd ?? null
      return createElement(actual.DndContext, props)
    },
  }
})

const { save, source, queryState } = vi.hoisted(() => ({ save: vi.fn(), source: { current: {
  revisionId: 'rev-1',
  documents: [
    { href: 'Text/one.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>One</p></body></html>' },
    { href: 'Text/two.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Two</p></body></html>' },
  ],
  tocEntries: [
    { href: 'Text/one.xhtml', title: 'One', level: 1 },
    { href: 'Text/two.xhtml', title: 'Two', level: 1 },
  ],
  spineOrder: ['Text/one.xhtml', 'Text/two.xhtml'],
} satisfies EditorEpubLoadRes }, queryState: { current: { isPending: false, isError: false, refetch: vi.fn() } } }))
const previewState = vi.hoisted(() => ({ manifest: undefined as unknown, content: undefined as string | undefined }))

vi.mock('../hooks/useEditorContent', () => ({
  useEditorEpubSource: () => ({ data: queryState.current.isError ? undefined : { data: source.current }, ...queryState.current }),
  useEditorManifest: () => ({ data: previewState.manifest }),
  useEditorSpineText: () => ({ data: previewState.content, isPending: false }),
  useSaveEditorEpub: () => ({ mutateAsync: save, isPending: false }),
}))

import EpubContentEditor from './EpubContentEditor'

const book = { id: 'book-1', title: 'EPUB 测试书', format: 'epub', revisionId: 'rev-1' } as never
const saved: EditorTxtSaveRes = { revisionId: 'rev-2', changed: true, unlocated: { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 } }

describe('EPUB content editor', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useUiStore.setState({ systemTheme: 'light' })
    save.mockReset()
    draftClear.mockClear()
    useToastStore.getState().clearToasts()
    save.mockResolvedValue({ data: saved })
    source.current = {
      revisionId: 'rev-1',
      documents: [
        { href: 'Text/one.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>One</p></body></html>' },
        { href: 'Text/two.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Two</p></body></html>' },
      ],
      tocEntries: [
        { href: 'Text/one.xhtml', title: 'One', level: 1 },
        { href: 'Text/two.xhtml', title: 'Two', level: 1 },
      ],
      spineOrder: ['Text/one.xhtml', 'Text/two.xhtml'],
    }
    queryState.current = { isPending: false, isError: false, refetch: vi.fn() }
    previewState.manifest = undefined
    previewState.content = undefined
  })

  it('shows one warning instead of both success and warning when reading information cannot be matched', async () => {
    save.mockResolvedValueOnce({ data: { ...saved, unlocated: { ...saved.unlocated, progress: 1, notes: 2 } } })
    render(<EpubContentEditor book={book} />)
    fireEvent.change(screen.getByRole('textbox', { name: '目录标题 1' }), { target: { value: '新标题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ type: 'warning', message: { key: 'editor.savePartial', params: { count: 3 } } })]))
  })

  it('saves body source, TOC edits and spine order together, then allows grouped undo', async () => {
    render(<EpubContentEditor book={book} />)
    fireEvent.change(screen.getByRole('textbox', { name: '目录标题 1' }), { target: { value: '新标题' } })
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    act(() => dragHandlers.end!({ active: { id: 'Text/one.xhtml' }, over: { id: 'Text/two.xhtml' } } as DragEndEvent))
    expect(screen.getByText('已暂存 2 项修改')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByText('已暂存 1 项修改')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({
      baseRevisionId: 'rev-1', documents: [],
      tocEntries: [
        { href: 'Text/one.xhtml', title: '新标题', level: 1 },
        { href: 'Text/two.xhtml', title: 'Two', level: 1 },
      ],
      spineOrder: ['Text/one.xhtml', 'Text/two.xhtml'],
    }))
  })

  it('keeps XHTML body edits in the shared draft while switching spine documents', async () => {
    render(<EpubContentEditor book={book} />)
    const frame = await screen.findByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p>One</p>'
    fireEvent.load(frame)
    body.innerHTML = '<p><a href="two.xhtml"><ruby>Edited<rt>uno</rt></ruby></a><img src="picture.bin"></p>'
    fireEvent.input(body)
    fireEvent.change(screen.getByRole('textbox', { name: '目录标题 1' }), { target: { value: 'Renamed One' } })
    fireEvent.click(screen.getByRole('button', { name: 'Two' }))
    const secondFrame = await screen.findByTitle('EPUB 正文编辑区')
    secondFrame.contentDocument!.body.innerHTML = '<p>Two</p>'
    fireEvent.load(secondFrame)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[0].documents.map((document) => document.href)).toEqual(['Text/one.xhtml'])
    expect(save.mock.calls[0]?.[0].documents[0]?.content).toContain('<a href="two.xhtml"><ruby>Edited<rt>uno</rt></ruby></a>')
    expect(save.mock.calls[0]?.[0].tocEntries[0]?.title).toBe('Renamed One')
  })

  it('reloads the selected XHTML after saving so editing can continue in place', async () => {
    const view = render(<EpubContentEditor book={book} />)
    const frame = await screen.findByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p>One</p>'
    fireEvent.load(frame)
    body.innerHTML = '<p>Saved text</p>'
    fireEvent.input(body)
    queryState.current.refetch.mockImplementationOnce(async () => {
      source.current = {
        ...source.current,
        revisionId: 'rev-2',
        documents: source.current.documents.map((document) => document.href === 'Text/one.xhtml'
          ? { ...document, content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Saved text</p></body></html>' }
          : document),
      }
      view.rerender(<EpubContentEditor book={{ ...book, revisionId: 'rev-2' }} />)
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    let reloadedFrame = await screen.findByTitle('EPUB 正文编辑区')
    await waitFor(() => {
      const currentFrame = screen.getByTitle('EPUB 正文编辑区')
      expect(currentFrame).not.toBe(frame)
      reloadedFrame = currentFrame
    })
    await waitFor(() => expect(reloadedFrame.srcdoc).toContain('Saved text'))
    expect(screen.queryByTitle('暂存只在当前浏览器生效，不会正式保存。点击查看修改。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.load(reloadedFrame)
    const reloadedBody = reloadedFrame.contentDocument!.body
    reloadedBody.innerHTML = '<p>Saved text then continued</p>'
    fireEvent.input(reloadedBody)
    expect(screen.getByText('正在暂存 1 项修改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  })

  it('shows a read error instead of an endless loading message', () => {
    queryState.current = { ...queryState.current, isError: true }
    render(<EpubContentEditor book={book} />)

    expect(screen.getByText('EPUB 内容读取失败，请返回后重试。')).toBeInTheDocument()
    expect(screen.queryByText('正在载入编辑内容…')).not.toBeInTheDocument()
  })

  it('keeps a dirty EPUB draft bound to its opened revision after a concurrent update', async () => {
    save.mockRejectedValueOnce(new Error('revision changed'))
    const view = render(<EpubContentEditor book={book} />)
    fireEvent.change(screen.getByRole('textbox', { name: '目录标题 1' }), { target: { value: '尚未保存标题' } })
    source.current = { ...source.current, revisionId: 'rev-2' }
    view.rerender(<EpubContentEditor book={{ ...book, revisionId: 'rev-2' }} />)

    expect(screen.getByRole('textbox', { name: '目录标题 1' })).toHaveValue('尚未保存标题')
    expect(await screen.findByRole('alert')).toHaveTextContent('书籍内容已更新，当前草稿无法直接保存')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseRevisionId: 'rev-1' })))
    expect(await screen.findAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: '目录标题 1' })).toHaveValue('尚未保存标题')
  })

  it('navigates fragments inside one XHTML file and keeps unlisted spine files in auxiliary navigation', async () => {
    source.current = {
      revisionId: 'rev-1',
      documents: [
        { href: 'Text/one.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="part-one">Part One</h1><h2 id="part-two">Part Two</h2></body></html>' },
        { href: 'Text/two.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Two</p></body></html>' },
        { href: 'Text/hidden.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hidden</p></body></html>' },
      ],
      tocEntries: [
        { href: 'Text/one.xhtml#part-one', title: 'Part One', level: 1 },
        { href: 'Text/one.xhtml#part-two', title: 'Part Two', level: 2 },
        { href: 'Text/two.xhtml', title: 'Second File', level: 1 },
      ],
      spineOrder: ['Text/one.xhtml', 'Text/two.xhtml', 'Text/hidden.xhtml'],
    }
    render(<EpubContentEditor book={book} />)

    const nestedEntry = screen.getAllByRole('treeitem').find((item) => item.getAttribute('aria-level') === '2')
    expect(nestedEntry).toHaveTextContent('Part Two')
    const frame = await screen.findByTitle('EPUB 正文编辑区')
    const scroll = vi.fn()
    Object.defineProperty(frame.contentWindow!.Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    frame.contentDocument!.body.innerHTML = '<h1 id="part-one">Part One</h1><h2 id="part-two">Part Two</h2>'
    fireEvent.click(screen.getByRole('button', { name: 'Part Two' }))
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    expect(screen.getByText('未列入目录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3. hidden.xhtml' })).toBeInTheDocument()
    delete (frame.contentWindow!.Element.prototype as Element & { scrollIntoView?: () => void }).scrollIntoView
  })

  it('moves a selected TOC parent with its subtree as one draft operation', () => {
    source.current = {
      ...source.current,
      tocEntries: [
        { href: 'Text/one.xhtml', title: 'Parent', level: 1 },
        { href: 'Text/two.xhtml#child', title: 'Child', level: 2 },
        { href: 'Text/two.xhtml', title: 'Other', level: 1 },
        { href: 'Text/one.xhtml#last', title: 'Last', level: 1 },
      ],
    }
    render(<EpubContentEditor book={book} />)
    fireEvent.click(screen.getByRole('button', { name: 'Other' }), { ctrlKey: true })
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    act(() => dragHandlers.end!({
      active: { id: 'toc-0', rect: { current: { translated: { top: 100, height: 20 } } } },
      over: { id: 'toc-3', rect: { top: 20, height: 20 } },
    } as DragEndEvent))

    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Last'), expect.stringContaining('Parent'), expect.stringContaining('Child'), expect.stringContaining('Other'),
    ])
  })

  it('reorders files independently and supports undo and redo across views', async () => {
    render(<EpubContentEditor book={book} />)
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    act(() => dragHandlers.end!({ active: { id: 'Text/one.xhtml' }, over: { id: 'Text/two.xhtml' } } as DragEndEvent))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    fireEvent.click(screen.getByRole('button', { name: '按目录' }))
    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual(['One', 'Two'])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      tocEntries: source.current.tocEntries, spineOrder: ['Text/two.xhtml', 'Text/one.xhtml'],
    })))
  })

  it('keeps modifier selection separate from the current document and hides hierarchy controls', () => {
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    fireEvent.click(screen.getByRole('button', { name: 'Two' }), { ctrlKey: true })
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '目录标题 1' })).toHaveValue('One')
    expect(screen.getByTitle('EPUB 正文编辑区')).toBe(frame)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提高层级|降低层级/ })).not.toBeInTheDocument()
  })

  it('updates the iframe theme in place without dirtying or replacing the edited body', async () => {
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p>One</p>'
    fireEvent.load(frame)
    const initialSrcDoc = frame.srcdoc
    const textNode = body.firstChild
    act(() => useUiStore.setState({ systemTheme: 'dark' }))
    await waitFor(() => expect(frame.contentDocument!.head.textContent).toContain('color-scheme:dark'))
    expect(screen.getByTitle('EPUB 正文编辑区')).toBe(frame)
    expect(frame.srcdoc).toBe(initialSrcDoc)
    expect(body.firstChild).toBe(textNode)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('opens a non-spine cover image as a read-only preview', () => {
    source.current.tocEntries.unshift({ href: 'Images/cover.svg', title: 'Cover', level: 1 })
    previewState.manifest = { manifest: { bookId: 'book-1', revisionId: 'rev-1', formatVersion: 1, startupFiles: [], entries: [{ path: 'Images/cover.svg', mediaType: 'image/svg+xml', size: 10 }] }, accountScope: 'test', epoch: 0, contentUrl: '/api/v1/books/book-1/file?revisionId=rev-1' }
    render(<EpubContentEditor book={book} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cover' }))
    const frame = screen.getByTitle('EPUB 正文编辑区')
    expect(frame.srcdoc).toContain('src="./cover.svg"')
    fireEvent.load(frame)
    expect(frame.contentDocument!.body.contentEditable).toBe('false')
    expect(screen.getByText('此目录项不可在工作台编辑，仅供预览。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('previews a non-spine XHTML target without adding it to the draft', () => {
    source.current.tocEntries.unshift({ href: 'Text/cover.xhtml', title: 'Cover page', level: 1 })
    previewState.manifest = { manifest: { bookId: 'book-1', revisionId: 'rev-1', formatVersion: 1, startupFiles: [], entries: [{ path: 'Text/cover.xhtml', mediaType: 'application/xhtml+xml', size: 30 }] }, accountScope: 'test', epoch: 0, contentUrl: '/api/v1/books/book-1/file?revisionId=rev-1' }
    previewState.content = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Cover content</p></body></html>'
    render(<EpubContentEditor book={book} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cover page' }))
    const frame = screen.getByTitle('EPUB 正文编辑区')
    expect(frame.srcdoc).toContain('Cover content')
    fireEvent.load(frame)
    expect(frame.contentDocument!.body.contentEditable).toBe('false')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('toggles background contrast without replacing the editing frame or changing the draft', () => {
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    frame.contentDocument!.body.innerHTML = '<p>One</p>'
    fireEvent.load(frame)
    const node = frame.contentDocument!.body.firstChild
    fireEvent.click(screen.getByRole('button', { name: '增强背景文字：关' }))
    expect(frame.contentDocument!.head.textContent).toContain('text-shadow:0 1px 2px')
    expect(frame.contentDocument!.body.firstChild).toBe(node)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('flushes typing to the draft without resetting srcdoc or the live editing nodes', async () => {
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p>One</p>'
    fireEvent.load(frame)
    const initialSrcDoc = frame.srcdoc
    body.firstElementChild!.textContent = 'One continued'
    const paragraph = body.firstElementChild
    fireEvent.input(body)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    expect(screen.getByTitle('EPUB 正文编辑区')).toBe(frame)
    expect(frame.srcdoc).toBe(initialSrcDoc)
    expect(body.firstElementChild).toBe(paragraph)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ documents: [expect.objectContaining({ content: expect.stringContaining('One continued') })] })))
  })

  it('flushes the current document before editing another document from secondary navigation', async () => {
    render(<EpubContentEditor book={book} />)
    const firstFrame = screen.getByTitle('EPUB 正文编辑区')
    firstFrame.contentDocument!.body.innerHTML = '<p>One</p>'
    fireEvent.load(firstFrame)
    firstFrame.contentDocument!.body.innerHTML = '<p>First pending edit</p>'
    fireEvent.input(firstFrame.contentDocument!.body)
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    fireEvent.click(screen.getByRole('button', { name: '2. two.xhtml' }))
    const secondFrame = screen.getByTitle('EPUB 正文编辑区')
    secondFrame.contentDocument!.body.innerHTML = '<p>Two</p>'
    fireEvent.load(secondFrame)
    secondFrame.contentDocument!.body.innerHTML = '<p>Second pending edit</p>'
    fireEvent.input(secondFrame.contentDocument!.body)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]![0].documents).toEqual([
      expect.objectContaining({ href: 'Text/one.xhtml', content: expect.stringContaining('First pending edit') }),
      expect.objectContaining({ href: 'Text/two.xhtml', content: expect.stringContaining('Second pending edit') }),
    ])
  })

  it('flushes rapid view switches without replacing the same frame or recording the switch', async () => {
    source.current.tocEntries = [
      { href: 'Text/one.xhtml#first', title: 'First', level: 1 },
      { href: 'Text/one.xhtml#second', title: 'Second', level: 1 },
    ]
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    frame.contentDocument!.body.innerHTML = '<p id="first">One</p><p id="second">Two</p>'
    fireEvent.load(frame)
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    frame.contentDocument!.body.innerHTML = '<p id="first">Edited</p><p id="second">Two</p>'
    fireEvent.input(frame.contentDocument!.body)
    fireEvent.click(screen.getByRole('button', { name: '按文件' }))
    expect(screen.getByTitle('EPUB 正文编辑区')).toBe(frame)
    expect(screen.queryByRole('textbox', { name: /目录标题/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按目录' }))
    expect(screen.getByTitle('EPUB 正文编辑区')).toBe(frame)
    expect(screen.getByRole('textbox', { name: '目录标题 2' })).toHaveValue('Second')
    expect(screen.getByText('已暂存 1 项修改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      documents: [expect.objectContaining({ href: 'Text/one.xhtml', content: expect.stringContaining('Edited') })],
      tocEntries: source.current.tocEntries,
    })))
  })

  it('clears pending changes when typed text is removed despite XHTML serialization normalization', async () => {
    source.current.documents[0]!.content = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p class="paragraph">One<br /></p></body></html>'
    render(<EpubContentEditor book={book} />)
    const frame = screen.getByTitle('EPUB 正文编辑区')
    const body = frame.contentDocument!.body
    body.innerHTML = '<p class="paragraph">One<br></p>'
    fireEvent.load(frame)
    body.firstChild!.firstChild!.nodeValue = 'One!'
    fireEvent.input(body)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    body.firstChild!.firstChild!.nodeValue = 'One'
    fireEvent.input(body)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.queryByText(/项待保存修改/)).not.toBeInTheDocument()
  })

  it('drops a TOC item after the final sibling while retaining current entry and independent spine order', async () => {
    render(<EpubContentEditor book={book} />)
    act(() => dragHandlers.end!({
      active: { id: 'toc-0', rect: { current: { translated: { top: 40, height: 20 } } } },
      over: { id: 'toc-1', rect: { top: 20, height: 20 } },
    } as DragEndEvent))
    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual(['Two', 'One'])
    expect(screen.getByRole('textbox', { name: '目录标题 2' })).toHaveValue('One')
    expect(screen.getByText('已暂存 1 项修改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('textbox', { name: '目录标题 1' })).toHaveValue('One')
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('textbox', { name: '目录标题 2' })).toHaveValue('One')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      tocEntries: [source.current.tocEntries[1], source.current.tocEntries[0]],
      spineOrder: source.current.spineOrder,
    })))
  })

  it('rejects a child drop into another parent without changing hierarchy or the draft', () => {
    source.current.tocEntries = [
      { href: 'Text/one.xhtml', title: 'Parent', level: 1 },
      { href: 'Text/one.xhtml#child', title: 'Child', level: 2 },
      { href: 'Text/two.xhtml', title: 'Other', level: 1 },
    ]
    render(<EpubContentEditor book={book} />)
    act(() => dragHandlers.end!({
      active: { id: 'toc-1', rect: { current: { translated: { top: 40, height: 20 } } } },
      over: { id: 'toc-2', rect: { top: 20, height: 20 } },
    } as DragEndEvent))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getAllByRole('treeitem')[1]).toHaveAttribute('aria-level', '2')
    expect(screen.getByText(/拖拽不会改变层级/)).toBeInTheDocument()
  })
})
