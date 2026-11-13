import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CATEGORY_TEMPLATES, type CatalogBook, type FileMetadataSourceRes } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import { notify } from '@/lib/notifications'
import WorkEditDialog from '../features/library/components/WorkEditDialog'
import { ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth.store'

function fileSource(overrides: Partial<FileMetadataSourceRes['values']> = {}): FileMetadataSourceRes {
  return {
    kind: 'file', format: 'epub', fileName: 'a.epub', normalizeTitleApplied: false,
    values: { title: 'File Title', authors: null, description: null, publisher: null, published: null, language: null, isbn: null, subjects: null, series: null, seriesIndex: null, ...overrides },
    provenance: { title: 'file', authors: 'missing', description: 'missing', publisher: 'missing', published: 'missing', language: 'missing', isbn: 'missing', subjects: 'missing', series: 'missing', seriesIndex: 'missing' },
  }
}

const HOOKS = vi.hoisted(() => ({
  useLibraryCategories: vi.fn(),
  useLibraryTags: vi.fn(),
  useCreateLibraryCategory: vi.fn(),
  useCreateLibraryTag: vi.fn(),
  useUpdateCatalogBook: vi.fn(),
  useUpdateCatalogVersion: vi.fn(),
  useUploadCatalogVersionCover: vi.fn(),
  useRemoveCatalogVersionCover: vi.fn(),
  useCatalogVersionMetadataSource: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

global.URL.createObjectURL = vi.fn(() => 'blob:mock-cover-preview')
global.URL.revokeObjectURL = vi.fn()

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, authors: null, description: null, coverKey: null, meta: {},
    effective: {
      title: 'City Book', author: 'Someone', authors: ['Someone'], description: 'A tale',
      coverKey: null, bookmeta: {}, fileName: null,
    },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, guestReadable: false, createdAt: 1, updatedAt: 1,
    ...overrides,
  } as CatalogBook['versions'][number]
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: 'cat1', title: 'City Book', author: 'Someone',
    authors: ['Someone'], description: 'A tale', coverKey: null, meta: {}, hidden: false,
    effectiveHidden: false, hiddenReason: null, pinnedAt: null, deletedAt: null,
    defaultVersionLinkId: null, tags: [{ id: 't1', name: 'classic' }],
    versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  } as CatalogBook
}

describe('WorkEditDialog', () => {
  const updateBook = vi.fn()
  const updateVersion = vi.fn()
  const uploadVersionCover = vi.fn()
  const removeVersionCover = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({ user: { id: 'metadata-account', username: 'Owner', role: 'owner' } })
    HOOKS.useLibraryCategories.mockReturnValue({ data: { data: [{ id: 'cat1', name: '小说', parentId: null }, { id: 'cat2', name: '散文', parentId: null }] } })
    HOOKS.useLibraryTags.mockReturnValue({ data: { data: [{ id: 't1', name: 'classic' }, { id: 't2', name: 'new' }] } })
    HOOKS.useCreateLibraryCategory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    HOOKS.useCreateLibraryTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    HOOKS.useUpdateCatalogBook.mockReturnValue({ mutateAsync: updateBook, isPending: false })
    HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutateAsync: updateVersion, isPending: false })
    HOOKS.useUploadCatalogVersionCover.mockReturnValue({ mutateAsync: uploadVersionCover, isPending: false })
    HOOKS.useRemoveCatalogVersionCover.mockReturnValue({ mutateAsync: removeVersionCover, isPending: false })
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() })
  })

  function renderDialog(target = work(), targetVersionIndex = 0) {
    const selectedVersion = target.versions[targetVersionIndex] ?? target.versions[0]!
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WorkEditDialog
          work={target}
          libraryId="lib_city"
          version={selectedVersion}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )
  }

  function mockLookupFetch(candidates: unknown[]) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      const body = url.includes('/integrations/personal-sources') ? { data: [] } : { data: candidates }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
  }

  it('shows a single form with the version resolved values and no work-info layer', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: '作品信息' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /版本 1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '版本' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('版本名')).not.toBeInTheDocument()
    expect(screen.queryByTestId('work-cover-input')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveValue('City Book')
    expect(screen.getByRole('textbox', { name: '作者' })).toHaveValue('Someone')
    expect(screen.getByRole('textbox', { name: '简介' })).toHaveValue('A tale')
  })

  it('saves title, authors and description to the version only', async () => {
    renderDialog()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'City Book 2' } })
    fireEvent.change(screen.getByRole('textbox', { name: '作者' }), { target: { value: 'Someone Else' } })
    fireEvent.change(screen.getByRole('textbox', { name: '简介' }), { target: { value: 'A new tale' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1',
      patch: { title: 'City Book 2', authors: ['Someone Else'], description: 'A new tale' },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('applies a metadata lookup to the current version without writing the work row', async () => {
    const fetchMock = mockLookupFetch([{ id: '/works/OL1W', provider: 'openlibrary', title: 'Matched title', authors: ['Matched author'], sourceUrl: 'https://openlibrary.org/works/OL1W' }])
    try {
      renderDialog()
      fireEvent.click(screen.getByRole('button', { name: '刮削' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Open Library/ }))
      fireEvent.click(await screen.findByRole('button', { name: /Matched title/ }))
      fireEvent.click(screen.getByLabelText('替换已有信息'))
      fireEvent.click(screen.getByRole('button', { name: '应用' }))
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      await waitFor(() => expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({
        versionLinkId: 'lbv1', patch: expect.objectContaining({ title: 'Matched title', authors: ['Matched author'] }),
      })))
      expect(updateBook).not.toHaveBeenCalled()
    } finally { fetchMock.mockRestore() }
  })

  it('reports no changes without sending a save request', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith({ key: 'library.catalogNoChanges' }))
    expect(updateBook).not.toHaveBeenCalled()
    expect(updateVersion).not.toHaveBeenCalled()
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('reports partially saved work and version changes without closing', async () => {
    updateBook.mockResolvedValueOnce({ data: {} })
    updateVersion.mockRejectedValueOnce(new Error('Offline'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '新建标签' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'new' }))
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Saved title' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith({ key: 'library.catalogSavePartial', params: { succeeded: 1, failed: 1 } }))
    expect(notify.success).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveValue('Saved title')
  })

  it('retains an oversized imported description and blocks all saves until it is shortened', async () => {
    const longDescription = 'a'.repeat(4001)
    const fetchMock = mockLookupFetch([{ id: '/works/OL1W', provider: 'openlibrary', title: 'Matched title', authors: [], description: longDescription, sourceUrl: 'https://openlibrary.org/works/OL1W' }])
    try {
      renderDialog()
      fireEvent.click(screen.getByRole('button', { name: '刮削' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Open Library/ }))
      fireEvent.click(await screen.findByRole('button', { name: /Matched title/ }))
      if (!(screen.getByLabelText('替换已有信息') as HTMLInputElement).checked) fireEvent.click(screen.getByLabelText('替换已有信息'))
      fireEvent.click(screen.getByRole('button', { name: '应用' }))
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      expect(notify.warning).toHaveBeenCalledWith({ key: 'library.catalogDescriptionTooLong' })
      expect(updateBook).not.toHaveBeenCalled()
      expect(updateVersion).not.toHaveBeenCalled()
    } finally { fetchMock.mockRestore() }
  })

  it('never offers an inherit action, only file restore', () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource({ title: 'City Book' }) }, isFetching: false, isError: false })
    renderDialog()
    expect(screen.queryByRole('button', { name: '恢复跟随' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Different' } })
    expect(screen.getByRole('button', { name: '恢复文件值' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复跟随' })).not.toBeInTheDocument()
  })

  it('edits extended publication metadata and saves explicit empty masks on the version', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /更多信息/ }))
    fireEvent.change(screen.getByLabelText('出版商'), { target: { value: '三联书店' } })
    fireEvent.change(screen.getByLabelText('系列'), { target: { value: '经典文库' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1',
      patch: {
        meta: {
          publisher: '三联书店', series: '经典文库', published: null, language: null,
          isbn: null, subjects: null, seriesIndex: null,
        },
      },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('preserves unknown meta keys when saving version metadata', async () => {
    const v = version({
      meta: { publisher: '旧社', translator: '译者' },
      effective: {
        title: 'City Book', author: 'Someone', authors: ['Someone'], description: 'A tale',
        coverKey: null, bookmeta: { publisher: '旧社', translator: '译者' }, fileName: null,
      },
    })
    renderDialog(work({ versions: [v] }))
    fireEvent.change(screen.getByLabelText('出版商'), { target: { value: '三联书店' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({
      patch: { meta: expect.objectContaining({ publisher: '三联书店', translator: '译者' }) },
    })))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('uploads a new version cover image', async () => {
    renderDialog()
    const file = new File(['fake-cover-bytes'], 'cover.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('version-cover-input') as HTMLInputElement, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(uploadVersionCover).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', file,
    }))
  })

  it('removes an existing version cover image', async () => {
    renderDialog(work({ versions: [version({ coverKey: 'blobs/existing-version-cover.jpg' })] }))
    fireEvent.click(screen.getByRole('button', { name: '移除封面' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(removeVersionCover).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1',
    }))
  })

  it('sets default version when work has multiple versions', async () => {
    const v1 = version({ id: 'lbv1', name: '版本 1' })
    const v2 = version({ id: 'lbv2', name: '版本 2' })
    renderDialog(work({ versions: [v1, v2], defaultVersionLinkId: 'lbv1' }), 1)
    expect(screen.getByRole('button', { name: '版本' })).toHaveTextContent('版本 2')
    fireEvent.click(screen.getByRole('button', { name: '设为默认版本' }))
    expect(screen.getAllByText('默认').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', patch: { defaultVersionLinkId: 'lbv2' },
    }))
  })

  it('switches and edits multiple versions in a single save session', async () => {
    const v1 = version({ id: 'lbv1', name: '版本 1' })
    const v2 = version({ id: 'lbv2', name: '版本 2' })
    renderDialog(work({ versions: [v1, v2] }), 0)
    fireEvent.change(screen.getByPlaceholderText('版本 1'), { target: { value: '修订版' } })
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '版本 2' }))
    fireEvent.change(screen.getByPlaceholderText('版本 2'), { target: { value: '精装版' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { name: '修订版' },
    }))
    expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv2', patch: { name: '精装版' },
    })
  })

  it('restores file values directly into the draft without immediate writes', async () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({
      data: { data: fileSource({ authors: ['File Author'], publisher: 'File Press' }) },
      isFetching: false, isError: false, refetch: vi.fn(),
    })
    renderDialog()
    const resetBtn = screen.getByRole('button', { name: '恢复来源值' })
    fireEvent.click(resetBtn)
    await waitFor(() => expect(screen.getByDisplayValue('File Title')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1',
    })))
    const patch = updateVersion.mock.calls[0][0].patch
    expect(patch.title).toBe('File Title')
    expect(patch.meta).toMatchObject({ publisher: 'File Press' })
  })

  it('hides the source restore action when the file carried no embedded metadata', () => {
    // A text file yields file-name guesses only, so nothing is worth restoring.
    const txtSource = fileSource({ title: 'File Title', authors: ['File Author'] })
    txtSource.format = 'txt'
    txtSource.provenance.title = 'filename'
    txtSource.provenance.authors = 'filename'
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: txtSource }, isFetching: false, isError: false })
    renderDialog()
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Edited' } })
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
  })

  it('hides the restore action once the draft matches the file again', () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource({ title: 'City Book' }) }, isFetching: false, isError: false })
    renderDialog()
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Edited' } })
    expect(screen.getByRole('button', { name: '恢复来源值' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复来源值' }))
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveValue('City Book')
  })

  it.each([true, false])('does not restore cached sources during a refresh or after a denial (fetching=%s)', (fetching) => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource() }, isFetching: fetching, isError: !fetching, error: new ApiError('FORBIDDEN', 'denied'), refetch: vi.fn() })
    renderDialog()
    expect(screen.queryByRole('button', { name: '恢复来源值' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    if (!fetching) expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('errors.forbidden'))
  })

  it('restores one field without changing series index', async () => {
    const source = fileSource({ series: 'File Series', seriesIndex: 0 })
    source.provenance.title = 'filename'
    source.provenance.series = 'file'
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: source }, isFetching: false, isError: false })
    renderDialog(work({ versions: [version({
      meta: { series: 'Old Series', seriesIndex: 5 },
      effective: {
        title: 'City Book', author: 'Someone', authors: ['Someone'], description: 'A tale',
        coverKey: null, bookmeta: { series: 'Old Series', seriesIndex: 5 }, fileName: null,
      },
    })] }))
    fireEvent.click(within(screen.getByLabelText('系列').parentElement!).getByRole('button', { name: '恢复文件值' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalled())
    expect(updateVersion.mock.calls[0][0].patch.meta).toMatchObject({ series: 'File Series', seriesIndex: 5 })
  })

  it('creates and selects a new tag through the shared popover', async () => {
    const createdTag = { data: { id: 't_new', name: '硬核' } }
    let completeCreation!: (result: typeof createdTag) => void
    const createTag = vi.fn(() => new Promise<typeof createdTag>((resolve) => { completeCreation = resolve }))
    HOOKS.useCreateLibraryTag.mockReturnValue({ mutateAsync: createTag, isPending: false })
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '新建标签' }))
    const input = screen.getByPlaceholderText('搜索标签…')
    fireEvent.change(input, { target: { value: '硬核' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(createTag).toHaveBeenCalledWith({ libraryId: 'lib_city', name: '硬核' }))
    await act(async () => { completeCreation(createdTag) })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ tagIds: ['t1', 't_new'] }),
    })))
  })

  it('offers category recommendations and sends the template key to the work patch', async () => {
    const template = CATEGORY_TEMPLATES[0]!
    const templateName = i18n.t(`library.categoryTemplate.${template.key}.name`)
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '分类' }))
    fireEvent.click(screen.getByText('推荐分类'))
    fireEvent.click(screen.getByRole('radio', { name: templateName }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', patch: { categoryTemplateKey: template.key },
    }))
    expect(updateVersion).not.toHaveBeenCalled()
  })
})
