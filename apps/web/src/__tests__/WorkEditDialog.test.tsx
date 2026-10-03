import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import i18n from '../i18n/i18n'
import { notify } from '@/lib/notifications'
import WorkEditDialog from '../features/library/components/WorkEditDialog'
import { ApiError } from '../api/client'
import type { CatalogBook, FileMetadataSourceRes } from '@bookdock/shared'

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
  useUploadCatalogBookCover: vi.fn(),
  useRemoveCatalogBookCover: vi.fn(),
  useUploadCatalogVersionCover: vi.fn(),
  useRemoveCatalogVersionCover: vi.fn(),
  useResetCatalogVersionMetadata: vi.fn(),
  useCatalogVersionMetadataSource: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

// Mock URL.createObjectURL / revokeObjectURL for file upload preview
global.URL.createObjectURL = vi.fn(() => 'blob:mock-cover-preview')
global.URL.revokeObjectURL = vi.fn()

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, authors: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: 'A tale', coverKey: null, bookmeta: {}, fileName: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, guestReadable: false, pinnedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: 'cat1', title: 'City Book', author: 'Someone',
    description: 'A tale', coverKey: null, tags: [{ id: 't1', name: 'classic' }],
    versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  }
}

describe('WorkEditDialog', () => {
  const updateBook = vi.fn()
  const updateVersion = vi.fn()
  const uploadWorkCover = vi.fn()
  const removeWorkCover = vi.fn()
  const uploadVersionCover = vi.fn()
  const removeVersionCover = vi.fn()
  const resetVersionMetadata = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useLibraryCategories.mockReturnValue({ data: { data: [{ id: 'cat1', name: '小说' }, { id: 'cat2', name: '散文' }] } })
    HOOKS.useLibraryTags.mockReturnValue({ data: { data: [{ id: 't1', name: 'classic' }, { id: 't2', name: 'new' }] } })
    HOOKS.useCreateLibraryCategory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    HOOKS.useCreateLibraryTag.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    HOOKS.useUpdateCatalogBook.mockReturnValue({ mutateAsync: updateBook, isPending: false })
    HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutateAsync: updateVersion, isPending: false })
    HOOKS.useUploadCatalogBookCover.mockReturnValue({ mutateAsync: uploadWorkCover, isPending: false })
    HOOKS.useRemoveCatalogBookCover.mockReturnValue({ mutateAsync: removeWorkCover, isPending: false })
    HOOKS.useUploadCatalogVersionCover.mockReturnValue({ mutateAsync: uploadVersionCover, isPending: false })
    HOOKS.useRemoveCatalogVersionCover.mockReturnValue({ mutateAsync: removeVersionCover, isPending: false })
    HOOKS.useResetCatalogVersionMetadata.mockReturnValue({ mutateAsync: resetVersionMetadata, isPending: false })
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() })
  })

  function renderDialog(target = work(), targetVersionIndex = 0) {
    const selectedVersion = target.versions[targetVersionIndex] ?? target.versions[0]!
    render(
      <WorkEditDialog
        work={target}
        libraryId="lib_city"
        version={selectedVersion}
        versionIndex={targetVersionIndex}
        onClose={vi.fn()}
      />,
    )
  }

  it('edits the work and the visible version in one save', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '作品信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'City Book 2' } })

    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)
    fireEvent.change(screen.getByPlaceholderText('版本 1'), { target: { value: '精校版' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', patch: { title: 'City Book 2' },
    }))
    expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { name: '精校版' },
    })
  })

  it('reports partially saved work and version changes without closing', async () => {
    updateBook.mockResolvedValueOnce({ data: {} })
    updateVersion.mockRejectedValueOnce(new Error('Offline'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '作品信息' }))
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Saved title' } })
    fireEvent.click(screen.getByRole('button', { name: /版本 1/ }))
    fireEvent.change(screen.getByPlaceholderText('版本 1'), { target: { value: 'Unsaved version' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith({ key: 'library.catalogSavePartial', params: { succeeded: 1, failed: 1 } }))
    expect(notify.success).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('版本 1')).toHaveValue('Unsaved version')
  })

  it('reports no changes without sending a save request', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith({ key: 'library.catalogNoChanges' }))
    expect(updateBook).not.toHaveBeenCalled()
    expect(updateVersion).not.toHaveBeenCalled()
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('restores inheritance by following the work again', async () => {
    renderDialog(work({ versions: [version({ title: '旧标题' })] }))
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    // With existing override '旧标题', overrides are expanded and '恢复跟随' button is shown
    const restoreBtn = screen.getByRole('button', { name: '恢复跟随' })
    expect(restoreBtn).toBeInTheDocument()
    fireEvent.click(restoreBtn)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { title: null },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it.each([null, 'City Book'])('hides equal source and inheritance actions for title override %s', (title) => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource({ title: 'City Book' }) }, isFetching: false, isError: false })
    renderDialog(work({ versions: [version({ title })] }))
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复跟随' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveAttribute('placeholder', 'City Book')
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Different' } })
    expect(screen.getByRole('button', { name: '恢复文件值' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复跟随' })).toBeInTheDocument()
  })

  it('switches between work info and version settings tabs', () => {
    renderDialog()
    const workTab = screen.getByRole('button', { name: '作品信息' })
    const versionTab = screen.getByRole('button', { name: /版本 1/ })

    expect(workTab).toBeInTheDocument()
    expect(versionTab).toBeInTheDocument()

    fireEvent.click(versionTab)
    expect(screen.getByPlaceholderText('版本 1')).toBeVisible()

    fireEvent.click(workTab)
    expect(screen.getByRole('textbox', { name: '书名' })).toBeVisible()
  })

  it('edits extended publication metadata under version tab and saves version meta payload', async () => {
    renderDialog()
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    // Open more metadata in version tab
    fireEvent.click(screen.getByRole('button', { name: /更多信息/ }))

    // Fill publisher and series
    const publisherInput = screen.getByLabelText('出版商')
    fireEvent.change(publisherInput, { target: { value: '三联书店' } })

    const seriesInput = screen.getByLabelText('系列')
    fireEvent.change(seriesInput, { target: { value: '经典文库' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
      patch: {
        meta: {
          publisher: '三联书店',
          series: '经典文库',
        },
      },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('preserves unknown meta keys when saving version metadata', async () => {
    renderDialog(work({ versions: [version({ meta: { publisher: '旧社', translator: '译者' } })] }))
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    // Raw overrides pre-expand the panel; edit the publisher in place.
    fireEvent.change(screen.getByLabelText('出版商'), { target: { value: '三联书店' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
      patch: {
        meta: {
          publisher: '三联书店',
          translator: '译者',
        },
      },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('uploads a new version cover image', async () => {
    renderDialog()
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    const file = new File(['fake-cover-bytes'], 'cover.png', { type: 'image/png' })
    const fileInput = screen.getByTestId('version-cover-input') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(uploadVersionCover).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
      file,
    }))
  })

  it('uploads a work cover from the work tab', async () => {
    renderDialog()

    const file = new File(['fake-work-cover'], 'work-cover.png', { type: 'image/png' })
    const fileInput = screen.getByTestId('work-cover-input') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(uploadWorkCover).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      file,
    }))
    expect(removeWorkCover).not.toHaveBeenCalled()
  })

  it('removes the work cover from the work tab', async () => {
    renderDialog(work({ coverKey: 'blobs/work-cover.jpg' }))
    fireEvent.click(screen.getByRole('button', { name: '作品信息' }))

    fireEvent.click(screen.getByRole('button', { name: '移除封面' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(removeWorkCover).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
    }))
    expect(uploadWorkCover).not.toHaveBeenCalled()
  })

  it('removes an existing version cover image', async () => {
    renderDialog(work({ versions: [version({ coverKey: 'blobs/existing-version-cover.jpg' })] }))
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    const removeCoverBtn = screen.getByRole('button', { name: '移除封面' })
    expect(removeCoverBtn).toBeInTheDocument()

    fireEvent.click(removeCoverBtn)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(removeVersionCover).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
    }))
  })

  it('sets default version when work has multiple versions', async () => {
    const v1 = version({ id: 'lbv1', name: '版本 1' })
    const v2 = version({ id: 'lbv2', name: '版本 2' })
    const multiWork = work({ versions: [v1, v2], defaultVersionLinkId: 'lbv1' })

    renderDialog(multiWork, 1) // rendering for v2
    const versionTab = screen.getByRole('button', { name: /版本 2/ })
    fireEvent.click(versionTab)

    const defaultBtn = screen.getByRole('button', { name: '设为默认版本' })
    expect(defaultBtn).toBeInTheDocument()

    fireEvent.click(defaultBtn)
    expect(screen.getAllByText('默认').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(updateBook).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      patch: {
        defaultVersionLinkId: 'lbv2',
      },
    }))
  })

  it('switches and edits multiple versions in a single save session', async () => {
    const v1 = version({ id: 'lbv1', name: '版本 1' })
    const v2 = version({ id: 'lbv2', name: '版本 2' })
    const multiWork = work({ versions: [v1, v2] })

    renderDialog(multiWork, 0)
    // Edit version 1 name
    fireEvent.click(screen.getByRole('button', { name: /版本 1/ }))
    fireEvent.change(screen.getByPlaceholderText('版本 1'), { target: { value: '修订版' } })

    // Switch to version 2 and edit its name
    fireEvent.click(screen.getByRole('button', { name: /版本 2/ }))
    fireEvent.change(screen.getByPlaceholderText('版本 2'), { target: { value: '精装版' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
      patch: { name: '修订版' },
    }))
    expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv2',
      patch: { name: '精装版' },
    })
  })

  it('restores file values into the draft via ConfirmDialog without immediate writes', async () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({
      data: { data: { kind: 'file', format: 'epub', fileName: 'a.epub', normalizeTitleApplied: false, values: { title: 'File Title', authors: ['File Author'], description: null, publisher: 'File Press', published: null, language: null, isbn: null, subjects: null, series: null, seriesIndex: null }, provenance: { title: 'file', authors: 'file', description: 'missing', publisher: 'file', published: 'missing', language: 'missing', isbn: 'missing', subjects: 'missing', series: 'missing', seriesIndex: 'missing' } } },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderDialog()
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    const resetBtn = screen.getByRole('button', { name: '恢复来源值' })
    expect(resetBtn).toBeInTheDocument()

    fireEvent.click(resetBtn)

    const confirmDialog = await screen.findByRole('alertdialog')
    expect(confirmDialog).toBeInTheDocument()
    const confirmBtn = within(confirmDialog).getByRole('button', { name: '恢复来源值' })
    fireEvent.click(confirmBtn)

    expect(resetVersionMetadata).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByDisplayValue('File Title')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
    })))
    const patch = updateVersion.mock.calls[0][0].patch
    expect(patch.title).toBe('File Title')
    expect(patch.meta).toMatchObject({ publisher: 'File Press' })
  })
  async function restoreAll() {
    fireEvent.click(screen.getByRole('button', { name: '恢复来源值' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '恢复来源值' }))
  }

  it('saves missing file fields as explicit empty overrides, preserving unrelated keys and other versions', async () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource() }, isFetching: false, isError: false })
    renderDialog(work({ versions: [version({ meta: { publisher: 'Old', identifier: 'keep' } }), version({ id: 'lbv2' })], defaultVersionLinkId: 'lbv1' }))
    await restoreAll()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledTimes(1))
    expect(updateBook).not.toHaveBeenCalled()
    expect(updateVersion.mock.calls[0][0]).toMatchObject({ versionLinkId: 'lbv1', patch: {
      title: 'File Title', authors: [], description: '', meta: { identifier: 'keep', publisher: null, subjects: null, seriesIndex: null },
    } })
  })

  it('blocks saving a restored missing title until the draft is filled', async () => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource({ title: null }) }, isFetching: false, isError: false })
    renderDialog()
    await restoreAll()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(updateVersion).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'New Title' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it.each([true, false])('does not restore cached sources during a refresh or after a denial (fetching=%s)', (fetching) => {
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: fileSource() }, isFetching: fetching, isError: !fetching, error: new ApiError('FORBIDDEN', 'denied'), refetch: vi.fn() })
    renderDialog()
    expect(screen.getByRole('button', { name: '恢复来源值' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '恢复文件值' })).not.toBeInTheDocument()
    if (!fetching) expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('errors.forbidden'))
  })

  it('labels inferred file names and restores one field without changing series index', async () => {
    const source = fileSource({ series: 'File Series', seriesIndex: 0 })
    source.provenance.title = 'filename'
    HOOKS.useCatalogVersionMetadataSource.mockReturnValue({ data: { data: source }, isFetching: false, isError: false })
    renderDialog(work({ versions: [version({ meta: { series: 'Old Series', seriesIndex: 5 } })] }))
    const titleRestore = within(screen.getByRole('textbox', { name: '书名' }).parentElement!).getByRole('button', { name: '恢复文件值' })
    fireEvent.focus(titleRestore)
    expect(screen.getByText(i18n.t('library.sourceProvenanceFilename'))).toBeInTheDocument()
    expect(screen.getByText('File Title')).toBeInTheDocument()
    fireEvent.blur(titleRestore)
    fireEvent.click(within(screen.getByLabelText('系列').parentElement!).getByRole('button', { name: '恢复文件值' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalled())
    expect(updateVersion.mock.calls[0][0].patch.meta).toMatchObject({ series: 'File Series', seriesIndex: 5 })
  })

  it('creates and selects a new category inline', async () => {
    const createCategory = vi.fn().mockResolvedValue({ data: { id: 'cat_new', name: '科幻' } })
    HOOKS.useCreateLibraryCategory.mockReturnValue({ mutateAsync: createCategory, isPending: false })
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '作品信息' }))

    fireEvent.click(screen.getByRole('button', { name: '+ 新建分类' }))
    const input = screen.getByPlaceholderText('新分类名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ libraryId: 'lib_city', name: '科幻' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ categoryId: 'cat_new' }),
    })))
  })

  it('creates and selects a new tag inline', async () => {
    const createTag = vi.fn().mockResolvedValue({ data: { id: 't_new', name: '硬核' } })
    HOOKS.useCreateLibraryTag.mockReturnValue({ mutateAsync: createTag, isPending: false })
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '作品信息' }))

    fireEvent.click(screen.getByRole('button', { name: '+ 新建标签' }))
    const input = screen.getByPlaceholderText('新标签名称')
    fireEvent.change(input, { target: { value: '硬核' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createTag).toHaveBeenCalledWith({ libraryId: 'lib_city', name: '硬核' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ tagIds: ['t1', 't_new'] }),
    })))
  })

})
