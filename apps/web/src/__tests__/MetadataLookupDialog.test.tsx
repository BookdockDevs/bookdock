import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MetadataLookupDialog from '../features/library/components/book-detail/MetadataLookupDialog'
import i18n from '../i18n/i18n'

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPostBlob: vi.fn() }))
const notifications = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('../api/client', () => api)
vi.mock('@/lib/notifications', () => ({ notify: notifications }))

const draft = { title: 'My title', authors: '', publisher: '', published: '', isbn: '', language: '', subjects: '', series: '', seriesIndex: '', description: 'My description', coverPaletteId: null }

function renderDialog(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('metadata lookup draft', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    localStorage.clear()
    api.apiGet.mockResolvedValue({ data: { googlebooks: false, weread: false } })
    api.apiPost.mockResolvedValue({ data: [{ id: '/works/OL1W', provider: 'openlibrary', title: 'Source title', authors: ['Writer'], description: 'Source description', publisher: 'Publisher', sourceUrl: 'https://openlibrary.org/works/OL1W' }] })
  })

  it('fills empty fields without overwriting existing values until replacement is selected', async () => {
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(await screen.findByRole('button', { name: /Source title/ }))
    expect(screen.getByRole('textbox', { name: '搜索关键词' })).toHaveValue('My title')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ title: 'My title', authors: 'Writer', description: 'My description', publisher: 'Publisher' }), undefined))
  })

  it('can replace a description whose source differs only in leading indentation', async () => {
    const apply = vi.fn()
    const description = '　　My description'
    api.apiPost.mockResolvedValueOnce({ data: [{ id: '/works/OL1W', provider: 'openlibrary', title: draft.title, authors: [], description, sourceUrl: 'https://openlibrary.org/works/OL1W' }] })
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(await screen.findByRole('button', { name: /My title/ }))
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('替换已有信息'))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ description }), undefined))
  })

  it('limits collected shared books to editable fields', async () => {
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited hasCover onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(await screen.findByRole('button', { name: /Source title/ }))
    fireEvent.click(screen.getByLabelText('替换已有信息'))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ title: 'Source title', authors: 'Writer', publisher: '', description: 'My description' }), undefined))
  })

  it('does not apply a late cover response after cancellation', async () => {
    let finish!: (value: Blob) => void
    api.apiPost.mockResolvedValue({ data: [{ id: '/works/OL1W', provider: 'openlibrary', title: 'Source title', authors: ['Writer'], coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg', sourceUrl: 'https://openlibrary.org/works/OL1W' }] })
    api.apiPostBlob.mockReturnValue(new Promise<Blob>((resolve) => { finish = resolve }))
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover={false} onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(await screen.findByRole('button', { name: /Source title/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    finish(new Blob(['image'], { type: 'image/jpeg' }))
    await vi.waitFor(() => expect(api.apiPostBlob).toHaveBeenCalledOnce())
    expect(apply).not.toHaveBeenCalled()
  })

  it('uses search results when detail fails and retries after deselection', async () => {
    const candidate = { id: '123', provider: 'douban', title: 'Book', authors: ['Search writer'], sourceUrl: 'https://book.douban.com/subject/123/' }
    api.apiPost.mockResolvedValueOnce({ data: [candidate] }).mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce({ data: { ...candidate, authors: ['Writer'], publisher: 'Publisher' } })
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '豆瓣' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Book/ }))
    await vi.waitFor(() => expect(notifications.warning).toHaveBeenCalledWith({ key: 'metadataLookup.detailError' }))
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^Book/ }))
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Book/ }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '应用' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ authors: 'Writer', publisher: 'Publisher' }), undefined))
  })

  it('selects the new search result rather than retaining the previous choice when details fail', async () => {
    const first = { id: '1', provider: 'douban', title: 'First', authors: ['Search author'], coverUrl: 'https://img3.doubanio.com/view/subject/s/public/s1.jpg', sourceUrl: 'https://book.douban.com/subject/1/' }
    const second = { ...first, id: '2', title: 'Second' }
    api.apiPost.mockResolvedValueOnce({ data: [first, second] })
      .mockResolvedValueOnce({ data: { ...first, authors: [], coverUrl: undefined, description: 'Detail description' } })
      .mockRejectedValueOnce(new Error('offline'))
    api.apiPostBlob.mockResolvedValueOnce(new Blob(['cover'], { type: 'image/jpeg' }))
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover={false} initialProvider="douban" onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(await screen.findByRole('button', { name: /^First/ }))
    expect(await screen.findByText('Detail description')).toBeInTheDocument()
    expect(screen.getByLabelText('更新封面')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ authors: 'Search author' }), expect.any(File)))
    fireEvent.click(screen.getByRole('button', { name: /^Second/ }))
    await vi.waitFor(() => expect(notifications.warning).toHaveBeenCalledWith({ key: 'metadataLookup.detailError' }))
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
    fireEvent.click(screen.getByLabelText('更新封面'))
    fireEvent.click(screen.getByLabelText('替换已有信息'))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second' }), undefined))
  })

  it('searches the selected WeRead scope and remembers it when reopened', async () => {
    api.apiGet.mockResolvedValue({ data: { googlebooks: false, weread: true } })
    api.apiPost.mockResolvedValue({ data: [] })
    const props = { draft, limited: false, hasCover: true, initialProvider: 'weread' as const, onApply: vi.fn(), onClose: vi.fn() }
    const dialog = renderDialog(<MetadataLookupDialog {...props} />)
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await vi.waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/integrations/metadata-lookup/search', expect.objectContaining({ weReadScope: 'all' }), expect.any(AbortSignal)))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '电子书' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '电子书' }))
    await vi.waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/integrations/metadata-lookup/search', expect.objectContaining({ weReadScope: 'ebooks' }), expect.any(AbortSignal)))
    dialog.unmount()
    renderDialog(<MetadataLookupDialog {...props} autoSearch />)
    expect(screen.getByRole('button', { name: '电子书' })).toHaveAttribute('aria-pressed', 'true')
    await vi.waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(3))
    expect(api.apiPost).toHaveBeenLastCalledWith('/integrations/metadata-lookup/search', expect.objectContaining({ weReadScope: 'ebooks' }), expect.any(AbortSignal))
  })

  it('does not display unconfigured providers in the scrape dropdown', async () => {
    api.apiGet.mockResolvedValue({ data: { googlebooks: false, weread: false } })
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '豆瓣' }))
    expect(screen.getByRole('menuitem', { name: '豆瓣' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '起点' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Bangumi' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open Library' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '微信读书' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Google Books' })).toBeNull()
  })

  it('displays WeRead in dropdown once configured and loads detail', async () => {
    const candidate = { id: '123', provider: 'weread', title: 'WeRead book', authors: [], sourceUrl: 'https://weread.qq.com/' }
    let finishDetail!: (value: unknown) => void
    api.apiGet.mockResolvedValue({ data: { googlebooks: false, weread: true } })
    api.apiPost.mockResolvedValueOnce({ data: [candidate] }).mockReturnValueOnce(new Promise((resolve) => { finishDetail = resolve }))
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }))
    const wereadItem = await screen.findByRole('menuitem', { name: '微信读书' })
    fireEvent.click(wereadItem)
    const bookBtn = await screen.findByRole('button', { name: /^WeRead book/ })
    fireEvent.click(bookBtn)
    expect(screen.getByRole('status', { name: '正在获取书籍详情…' })).toBeInTheDocument()
    finishDetail({ data: { ...candidate, authors: ['Writer'], description: 'Details description' } })
    expect(await screen.findByText('Details description')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '正在获取书籍详情…' })).toBeNull()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '应用' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ authors: 'Writer' }), undefined))
    expect(api.apiPost).toHaveBeenLastCalledWith('/integrations/metadata-lookup/detail', { provider: 'weread', id: '123' }, expect.any(AbortSignal))
  })

  it('persists and restores replace and updateCover preferences from localStorage', () => {
    localStorage.setItem('bd-metadata-replace', 'true')
    localStorage.setItem('bd-metadata-update-cover', 'false')
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByLabelText('替换已有信息')).toBeChecked()
    expect(screen.getByLabelText('更新封面')).not.toBeChecked()

    fireEvent.click(screen.getByLabelText('替换已有信息'))
    expect(localStorage.getItem('bd-metadata-replace')).toBe('false')

    fireEvent.click(screen.getByLabelText('更新封面'))
    expect(localStorage.getItem('bd-metadata-update-cover')).toBe('true')
  })

  it('allows clearing the search query input only when focused', () => {
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={vi.fn()} onClose={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: '搜索关键词' })
    expect(input).toHaveValue('My title')
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()

    fireEvent.focus(input)
    const clearBtn = screen.getByRole('button', { name: '清空' })
    fireEvent.mouseDown(clearBtn)
    expect(input).toHaveValue('')

    fireEvent.blur(input)
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull()
  })

  it('allows deselecting a candidate by clicking it again', async () => {
    api.apiPost.mockResolvedValueOnce({ data: [{ id: '/works/OL1W', provider: 'openlibrary', title: 'Source title', authors: ['Writer'], description: 'Source description', publisher: 'Publisher', sourceUrl: 'https://openlibrary.org/works/OL1W' }] })
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    const item = await screen.findByRole('button', { name: /Source title/ })
    fireEvent.click(item)
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
    fireEvent.click(item)
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
  })
})
