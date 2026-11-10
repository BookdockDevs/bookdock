import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MetadataLookupDialog from '../features/library/components/book-detail/MetadataLookupDialog'
import i18n from '../i18n/i18n'
import { useAuthStore } from '../stores/auth.store'

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))
const notifications = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }))
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
  afterEach(() => { useAuthStore.setState({ user: null }) })
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({ user: { id: 'metadata-account', username: 'Reader', role: 'user' } })
    api.apiGet.mockResolvedValue({ data: { googlebooks: false, weread: false } })
    api.apiPost.mockResolvedValue({ data: [{ id: '/works/OL1W', provider: 'openlibrary', title: 'Source title', authors: ['Writer'], description: 'Source description', publisher: 'Publisher', sourceUrl: 'https://openlibrary.org/works/OL1W' }] })
  })

  it('hides the source picker and blocks search without a service account', async () => {
    useAuthStore.setState({ user: null })
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover autoSearch onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '搜索' })).toBeDisabled()
    // The picker is absent rather than greyed out: no account, no service.
    expect(screen.queryByRole('button', { name: '豆瓣' })).toBeNull()
    await vi.waitFor(() => {
      expect(api.apiGet).not.toHaveBeenCalled()
      expect(api.apiPost).not.toHaveBeenCalled()
    })
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

  it('searches a personal source and selects instantly when it has no detail', async () => {
    api.apiGet.mockImplementation((path: string) => {
      if (path === '/integrations/personal-sources') {
        return Promise.resolve({ data: [{ sourceId: 'my-source', name: 'My Source', version: '1.0.0', originType: 'zip', hasIcon: false, hasDetail: false, createdAt: 1 }] })
      }
      return Promise.resolve({ data: { googlebooks: false, weread: false } })
    })
    api.apiPost.mockImplementation((path: string) => {
      if (path === '/integrations/metadata-lookup/search') {
        return Promise.resolve({ data: [{ id: 'src-1', provider: 'personal:my-source', title: 'Personal hit', authors: ['Author A'], description: 'Personal brief', sourceUrl: '' }] })
      }
      return Promise.resolve({ data: null })
    })
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '豆瓣' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'My Source' }))
    fireEvent.click(await screen.findByRole('button', { name: /Personal hit/ }))
    expect(api.apiPost).toHaveBeenCalledTimes(1)
    expect(api.apiPost).toHaveBeenCalledWith('/integrations/metadata-lookup/search', { provider: 'personal:my-source', query: 'My title' }, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ authors: 'Author A' }), undefined))
  })

  it('searches a personal source with a prefixed provider and merges its detail fields', async () => {
    api.apiGet.mockImplementation((path: string) => {
      if (path === '/integrations/personal-sources') {
        return Promise.resolve({ data: [{ sourceId: 'my-source', name: 'My Source', version: '1.0.0', originType: 'zip', hasIcon: false, hasDetail: true, createdAt: 1 }] })
      }
      return Promise.resolve({ data: { googlebooks: false, weread: false } })
    })
    api.apiPost.mockImplementation((path: string) => {
      if (path === '/integrations/metadata-lookup/search') {
        return Promise.resolve({ data: [{ id: 'src-1', provider: 'personal:my-source', title: 'Personal hit', authors: [], sourceUrl: '' }] })
      }
      return Promise.resolve({ data: { title: 'Detail title', description: 'Personal detail', authors: ['Author A'] } })
    })
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '豆瓣' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'My Source' }))
    fireEvent.click(await screen.findByRole('button', { name: /Personal hit/ }))
    expect(api.apiPost).toHaveBeenCalledWith('/integrations/metadata-lookup/search', { provider: 'personal:my-source', query: 'My title' }, expect.anything())
    expect(api.apiPost).toHaveBeenCalledWith('/integrations/metadata-lookup/detail', { provider: 'personal:my-source', id: 'src-1' }, expect.anything())
    await screen.findByText('Detail title')
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ authors: 'Author A', description: 'My description' }), undefined))
  })

  it('fetches personal covers client-side before falling back to the server proxy', async () => {
    api.apiGet.mockImplementation((path: string) => {
      if (path === '/integrations/personal-sources') {
        return Promise.resolve({ data: [{ sourceId: 'my-source', name: 'My Source', version: '1.0.0', originType: 'zip', hasIcon: false, hasDetail: false, createdAt: 1 }] })
      }
      return Promise.resolve({ data: { googlebooks: false, weread: false } })
    })
    api.apiPost.mockResolvedValue({ data: [{ id: 'src-1', provider: 'personal:my-source', title: 'Personal hit', authors: [], coverUrl: 'https://cdn.example.com/cover.webp', sourceUrl: '' }] })
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
    const fetchMock = vi.fn().mockResolvedValue(new Response(webp, { status: 200, headers: { 'content-type': 'application/octet-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover={false} onApply={apply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '豆瓣' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'My Source' }))
    fireEvent.click(await screen.findByRole('button', { name: /Personal hit/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.anything(), expect.any(File)))
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/cover.webp', expect.objectContaining({ mode: 'cors' }))
    expect(api.apiPostBlob).not.toHaveBeenCalled()
  })
  it('reports a failed search through a toast and reuses the no-results state', async () => {
    api.apiPost.mockRejectedValueOnce(new Error('blocked'))
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await vi.waitFor(() => expect(notifications.error).toHaveBeenCalledWith('搜索失败，来源可能暂不可用或限制了访问，请稍后重试。'))
    expect(await screen.findByText('没有找到结果，请尝试其他关键词。')).toBeInTheDocument()
    expect(screen.queryByText('搜索词会发送给选择的信息来源。')).not.toBeInTheDocument()
  })

  it('includes the server error detail in the search failure toast', async () => {
    api.apiPost.mockRejectedValueOnce(new api.ApiError('VALIDATION_ERROR', 'Metadata source unavailable (TimeoutError)'))
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await vi.waitFor(() => expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining('Metadata source unavailable (TimeoutError)')))
    expect(await screen.findByText('没有找到结果，请尝试其他关键词。')).toBeInTheDocument()
  })

  it('switches providers while a search is still running', async () => {
    let finishStale!: (value: { data: Array<Record<string, unknown>> }) => void
    api.apiPost.mockImplementationOnce(() => new Promise((resolve) => { finishStale = resolve }))
    api.apiPost.mockResolvedValueOnce({ data: [{ id: 'q1', provider: 'qidian', title: 'Qidian title', authors: [], sourceUrl: '' }] })
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover initialProvider="openlibrary" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(await screen.findByRole('status', { name: '搜索中…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '起点' }))
    await vi.waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(2))
    expect(api.apiPost).toHaveBeenLastCalledWith('/integrations/metadata-lookup/search', expect.objectContaining({ provider: 'qidian' }), expect.anything())
    // The stale response must not overwrite the newer search's results.
    finishStale({ data: [{ id: 'stale', provider: 'openlibrary', title: 'Stale title', authors: [], sourceUrl: '' }] })
    expect(await screen.findByRole('button', { name: /Qidian title/ })).toBeInTheDocument()
    expect(screen.queryByText('Stale title')).not.toBeInTheDocument()
  })

  it('prefetches personal sources on mount and keeps search results visible while applying a cover', async () => {
    let finishCover!: (value: Response) => void
    api.apiGet.mockImplementation((path: string) => {
      if (path === '/integrations/personal-sources') {
        return Promise.resolve({ data: [{ sourceId: 'my-source', name: 'My Source', version: '1.0.0', originType: 'zip', hasIcon: false, hasDetail: false, createdAt: 1 }] })
      }
      return Promise.resolve({ data: { googlebooks: false, weread: false } })
    })
    api.apiPost.mockResolvedValue({ data: [{ id: 'src-1', provider: 'personal:my-source', title: 'Personal hit', authors: [], coverUrl: 'https://cdn.example.com/cover.webp', sourceUrl: '' }] })
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishCover = resolve })))

    const apply = vi.fn()
    renderDialog(<MetadataLookupDialog draft={draft} limited={false} hasCover={false} onApply={apply} onClose={vi.fn()} />)

    // Prefetched before clicking the dropdown open.
    await vi.waitFor(() => expect(api.apiGet).toHaveBeenCalledWith('/integrations/personal-sources'))

    fireEvent.click(screen.getByRole('button', { name: '豆瓣' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'My Source' }))
    fireEvent.click(await screen.findByRole('button', { name: /Personal hit/ }))

    const applyBtn = screen.getByRole('button', { name: '应用' })
    fireEvent.click(applyBtn)

    await vi.waitFor(() => expect(applyBtn).toBeDisabled())
    expect(screen.getByRole('button', { name: /Personal hit/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '搜索中…' })).toBeNull()

    finishCover(new Response(webp, { status: 200, headers: { 'content-type': 'image/webp' } }))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(expect.anything(), expect.any(File)))
  })
})

