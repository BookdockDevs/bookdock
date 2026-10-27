import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/i18n'
import { useToastStore } from '@/stores/toast.store'

import ContentEditorPage from './ContentEditorPage'
import { createUnits } from './lib/create-editor-units'

const mocks = vi.hoisted(() => ({ save: vi.fn(), clear: vi.fn(), bookRevision: 'rev-1', pending: false, multiChapter: false }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/books/book-1">{children}</a>,
  useParams: () => ({ id: 'book-1' }),
  useSearch: () => ({}),
}))

vi.mock('./hooks/useEditorContent', () => ({
  useEditorBook: () => ({ data: { data: { id: 'book-1', title: '测试书', format: 'txt', revisionId: mocks.bookRevision, updatedAt: 1 } } }),
  useEditorChapters: () => {
    if (!mocks.multiChapter) return { data: { data: [{ id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, contentStartOffset: 5, endOffset: 7 }] } }
    const source = '第一章\n\n正文一\n\n第二章\n\n正文二\n\n第三章\n\n正文三'
    const second = source.indexOf('第二章')
    const third = source.indexOf('第三章')
    return { data: { data: [
      { id: 'chapter-1', title: '第一章', level: 0, startOffset: 0, contentStartOffset: 5, endOffset: source.indexOf('\n\n第二章') },
      { id: 'chapter-2', title: '第二章', level: 0, startOffset: second, contentStartOffset: second + 5, endOffset: source.indexOf('\n\n第三章') },
      { id: 'chapter-3', title: '第三章', level: 0, startOffset: third, contentStartOffset: third + 5, endOffset: source.length },
    ] } }
  },
  useEditorTxtSource: () => ({ data: mocks.multiChapter ? '第一章\n\n正文一\n\n第二章\n\n正文二\n\n第三章\n\n正文三' : '第一章\n\n正文' }),
  useSaveEditorTxt: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
}))

vi.mock('@/api/hooks/useTocRules', () => ({ useTocRules: () => ({ data: { data: [] } }) }))
vi.mock('./hooks/useEditorAccess', () => ({ useEditorAccess: () => 'allowed' }))
vi.mock('./hooks/useLocalEditorDraft', () => ({ useLocalEditorDraft: () => ({ ready: true, failure: null, status: 'saved', candidate: null, clear: mocks.clear }) }))
vi.mock('./hooks/useDraftNavigationGuard', async () => {
  const React = await import('react')
  return { useDraftNavigationGuard: (dirty: boolean, saving: boolean) => {
    const [blocked, setBlocked] = React.useState(false)
    React.useEffect(() => {
      if (!dirty && !saving) return
      const handler = (event: BeforeUnloadEvent) => event.preventDefault()
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }, [dirty, saving])
    return { blocked, back: () => setBlocked(dirty || saving), reset: () => setBlocked(false), proceed: () => setBlocked(false) }
  } }
})

describe('ContentEditorPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mocks.bookRevision = 'rev-1'
    mocks.pending = false
    mocks.multiChapter = false
    mocks.save.mockReset().mockResolvedValue({ data: { revisionId: 'rev-2', changed: true, unlocated: { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 } } })
    mocks.clear.mockReset().mockResolvedValue(undefined)
    useToastStore.getState().clearToasts()
  })

  it('keeps text changes in one draft, supports undo, and saves against the opened revision', async () => {
    render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    await waitFor(() => expect(body).toHaveValue('正文'))

    fireEvent.change(body, { target: { value: '修改后的正文' } })
    expect(screen.getByText('已暂存 1 项修改')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(body).toHaveValue('正文')

    fireEvent.change(body, { target: { value: '最终正文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      baseRevisionId: 'rev-1',
      chapters: [{ id: 'chapter-1', title: '第一章', content: '最终正文', level: 1 }],
      tocRuleSelection: { ruleId: null, patterns: null, label: null, auto: false },
    }))
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([expect.objectContaining({ message: { key: 'editor.saveSuccess' }, type: 'success' })])))
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(screen.queryByTitle('暂存只在当前浏览器生效，不会正式保存。点击查看修改。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(body, { target: { value: '保存后的新修改' } })
    expect(screen.getByText('已暂存 1 项修改')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('clears the dirty indicator after a chapter title is saved', async () => {
    render(<ContentEditorPage />)
    fireEvent.change(await screen.findByRole('textbox', { name: '章节标题' }), { target: { value: '新标题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByTitle('暂存只在当前浏览器生效，不会正式保存。点击查看修改。')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('keeps the shared draft available when unified save fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('temporary save failure'))
    render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    await waitFor(() => expect(body).toHaveValue('正文'))
    fireEvent.change(body, { target: { value: '保留在草稿里的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，草稿仍保留')
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(body).toHaveValue('保留在草稿里的修改')
    expect(screen.getByRole('button', { name: '放弃草稿' })).toBeEnabled()
  })

  it('uses a single warning notification when some reading information cannot be matched', async () => {
    mocks.save.mockResolvedValueOnce({ data: { revisionId: 'rev-2', changed: true, unlocated: { progress: 1, coverage: 0, highlights: 2, bookmarks: 0, notes: 0, pointReplacements: 0 } } })
    render(<ContentEditorPage />)
    fireEvent.change(await screen.findByRole('textbox', { name: '章节正文' }), { target: { value: '修改内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ type: 'warning', message: { key: 'editor.savePartial', params: { count: 3 } } })]))
    expect(screen.queryByLabelText('保存状态')).not.toBeInTheDocument()
  })

  it('locks editing while saving and blocks leaving a dirty draft', async () => {
    let resolveSave!: (value: unknown) => void
    mocks.save.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
    const view = render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    fireEvent.change(body, { target: { value: '提交快照' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    mocks.pending = true
    view.rerender(<ContentEditorPage />)
    expect(body).toBeDisabled()
    fireEvent.change(body, { target: { value: '保存期间的新输入' } })
    expect(body).toHaveValue('提交快照')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('link', { name: '返回阅读' }))
    expect(confirm).not.toHaveBeenCalled()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    confirm.mockRestore()
    resolveSave({ data: { revisionId: 'rev-2', changed: true, unlocated: { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 } } })
  })

  it('asks before navigating away from an unsaved draft', async () => {
    render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    fireEvent.change(body, { target: { value: '未保存正文' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('link', { name: '返回阅读' }), event)
    expect(screen.getByRole('button', { name: '保留草稿并离开' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃草稿并离开' })).toBeInTheDocument()
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps the opened base revision and preserves a draft when the book updates concurrently', async () => {
    mocks.save.mockRejectedValueOnce(new Error('revision changed'))
    const view = render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' })
    await waitFor(() => expect(body).toHaveValue('正文'))
    fireEvent.change(body, { target: { value: '并发时保留的草稿' } })
    mocks.bookRevision = 'rev-2'
    view.rerender(<ContentEditorPage />)

    expect(body).toHaveValue('并发时保留的草稿')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('书籍内容已更新，当前草稿无法直接保存')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ baseRevisionId: 'rev-1' }))
    expect(body).toHaveValue('并发时保留的草稿')
  })

  it('does not turn inter-chapter whitespace into a new draft chapter', () => {
    const source = '第一章\n\n正文一\n\n第二章\n\n正文二'
    const secondStart = source.indexOf('第二章')
    const units = createUnits(source, [
      { id: 'ch-1', title: '第一章', level: 1, startOffset: 0, contentStartOffset: 5, endOffset: source.indexOf('\n\n第二章') },
      { id: 'ch-2', title: '第二章', level: 1, startOffset: secondStart, contentStartOffset: secondStart + 5, endOffset: source.length },
    ])

    expect(units).toEqual([
      { id: 'ch-1', title: '第一章', content: '正文一', level: 1 },
      { id: 'ch-2', title: '第二章', content: '正文二', level: 1 },
    ])
  })

  it('sends a pure split heading as structure-only metadata for coverage projection', async () => {
    render(<ContentEditorPage />)
    const body = await screen.findByRole('textbox', { name: '章节正文' }) as HTMLTextAreaElement
    await waitFor(() => expect(body).toHaveValue('正文'))
    expect(screen.queryByRole('button', { name: '在光标处拆分' })).not.toBeInTheDocument()
    fireEvent.focus(body)
    body.setSelectionRange(2, 2)
    fireEvent.select(body)
    fireEvent.click(screen.getByRole('button', { name: '在光标处拆分' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      baseRevisionId: 'rev-1',
      chapters: [
        { id: 'chapter-1', title: '第一章', content: '正文', level: 1 },
        { id: expect.any(String), title: '新章节', content: '', level: 1, structureOnlyTitle: true },
      ],
      tocRuleSelection: { ruleId: null, patterns: null, label: null, auto: false },
    }))
  })

  it('adds a text preview into the same draft and makes the batch undoable', async () => {
    render(<ContentEditorPage />)
    await screen.findByRole('textbox', { name: '章节正文' })
    fireEvent.click(screen.getByRole('button', { name: '导入章节' }))
    fireEvent.click(screen.getByRole('tab', { name: '粘贴文本' }))
    fireEvent.change(screen.getByRole('textbox', { name: '粘贴文本' }), { target: { value: '新章节\n\n新增正文' } })
    expect(screen.getByRole('list', { name: '分章预览' })).toHaveTextContent('第1章(1)')
    fireEvent.click(screen.getByRole('button', { name: '导入到草稿' }))
    expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('第1章(1)')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('第一章')
  })

  it('reopens content tools with the TOC rule selection already applied to the draft', async () => {
    render(<ContentEditorPage />)
    await screen.findByRole('textbox', { name: '章节正文' })
    fireEvent.click(screen.getByRole('button', { name: '更换目录规则' }))
    fireEvent.click(screen.getByLabelText('新建专属规则'))
    fireEvent.click(screen.getByRole('button', { name: '添加层级' }))
    fireEvent.change(screen.getByRole('textbox', { name: '第1层正则表达式' }), { target: { value: '^新章$' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }))
    fireEvent.click(screen.getByRole('button', { name: '应用到草稿' }))

    fireEvent.click(screen.getByRole('button', { name: '更换目录规则' }))
    expect(screen.getByText('本书专属规则')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('编辑专属目录规则'))
    expect(screen.getByRole('textbox', { name: '第1层正则表达式' })).toHaveValue('^新章$')
  })

  it('moves a chapter to a target as one undoable operation and supports search and collapse', async () => {
    mocks.multiChapter = true
    render(<ContentEditorPage />)
    await screen.findByRole('textbox', { name: '章节正文' })
    const list = screen.getByRole('list', { name: '目录' })
    const items = list.querySelectorAll('li')
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('chapter-2') }
    fireEvent.dragStart(items[1]!, { dataTransfer })
    fireEvent.dragOver(items[0]!)
    fireEvent.drop(items[0]!, { dataTransfer })
    expect([...list.querySelectorAll('li span.truncate')].map((el) => el.textContent?.trim())).toEqual(['第二章', '第一章', '第三章'])
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect([...list.querySelectorAll('li span.truncate')].map((el) => el.textContent?.trim())).toEqual(['第一章', '第二章', '第三章'])
    fireEvent.click(screen.getByRole('button', { name: '搜索章节' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索章节' }), { target: { value: '第二' } })
    expect(screen.getByRole('button', { name: /第二章/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /第三章/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索章节' }), { target: { value: '' } })
  })

  it('drags the selected chapters as one undoable ordered move', async () => {
    mocks.multiChapter = true
    render(<ContentEditorPage />)
    await screen.findByRole('textbox', { name: '章节正文' })
    const list = screen.getByRole('list', { name: '目录' })
    const items = list.querySelectorAll('li')
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('chapter-3') }
    fireEvent.dragStart(items[2]!, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'chapter-3')
    fireEvent.dragOver(items[0]!)
    fireEvent.drop(items[0]!, { dataTransfer })
    expect([...list.querySelectorAll('li span.truncate')].map((el) => el.textContent?.trim())).toEqual(['第三章', '第一章', '第二章'])
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect([...list.querySelectorAll('li span.truncate')].map((el) => el.textContent?.trim())).toEqual(['第一章', '第二章', '第三章'])
  })

  it('supports Ctrl and Shift click for multi-selection and batch delete', async () => {
    mocks.multiChapter = true
    render(<ContentEditorPage />)
    await screen.findByRole('textbox', { name: '章节正文' })
    const list = screen.getByRole('list', { name: '目录' })
    const buttons = list.querySelectorAll('li > button')

    // Click first chapter normally
    fireEvent.click(buttons[0]!)
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument()

    // Ctrl+Click second chapter
    fireEvent.click(buttons[1]!, { ctrlKey: true })
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('第一章')

    // Reset with normal click
    fireEvent.click(buttons[0]!)
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument()

    // Single chapter delete (in-draft, no confirm popup)
    fireEvent.click(screen.getByRole('button', { name: '删除章节' }))
    expect(screen.queryByRole('button', { name: /第一章/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: /第一章/ })).toBeInTheDocument()

    // Multi-select chapters 1 and 2 to merge (in-draft, no confirm popup)
    const listAgain = screen.getByRole('list', { name: '目录' })
    const refreshedButtons = listAgain.querySelectorAll('li > button')
    fireEvent.click(refreshedButtons[0]!)
    fireEvent.click(refreshedButtons[1]!, { ctrlKey: true })
    expect(screen.getByRole('button', { name: '合并所选章节' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '合并所选章节' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))

    // Shift+Click third chapter selects 1..3
    fireEvent.click(refreshedButtons[0]!)
    fireEvent.click(refreshedButtons[2]!, { shiftKey: true })
    expect(screen.getByText('已选 3 项')).toBeInTheDocument()

    // Batch delete (in-draft, no confirm popup)
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(screen.getByText(/已暂存 \d+ 项修改/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: /第一章/ })).toBeInTheDocument()
  })
})
