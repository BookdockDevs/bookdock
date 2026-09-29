import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import i18n from '../i18n/i18n'
import WorkEditDialog from '../features/library/components/WorkEditDialog'
import type { CatalogBook } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useLibraryCategories: vi.fn(),
  useLibraryTags: vi.fn(),
  useUpdateCatalogBook: vi.fn(),
  useUpdateCatalogVersion: vi.fn(),
  useUploadCatalogBookCover: vi.fn(),
  useRemoveCatalogBookCover: vi.fn(),
  useUploadCatalogVersionCover: vi.fn(),
  useRemoveCatalogVersionCover: vi.fn(),
  useResetCatalogVersionMetadata: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

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
    HOOKS.useUpdateCatalogBook.mockReturnValue({ mutateAsync: updateBook, isPending: false })
    HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutateAsync: updateVersion, isPending: false })
    HOOKS.useUploadCatalogBookCover.mockReturnValue({ mutateAsync: uploadWorkCover, isPending: false })
    HOOKS.useRemoveCatalogBookCover.mockReturnValue({ mutateAsync: removeWorkCover, isPending: false })
    HOOKS.useUploadCatalogVersionCover.mockReturnValue({ mutateAsync: uploadVersionCover, isPending: false })
    HOOKS.useRemoveCatalogVersionCover.mockReturnValue({ mutateAsync: removeVersionCover, isPending: false })
    HOOKS.useResetCatalogVersionMetadata.mockReturnValue({ mutateAsync: resetVersionMetadata, isPending: false })
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
    fireEvent.change(screen.getByLabelText('书名'), { target: { value: 'City Book 2' } })

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

  it('switches between work info and version settings tabs', () => {
    renderDialog()
    const workTab = screen.getByRole('button', { name: '作品信息' })
    const versionTab = screen.getByRole('button', { name: /版本 1/ })

    expect(workTab).toBeInTheDocument()
    expect(versionTab).toBeInTheDocument()

    fireEvent.click(versionTab)
    expect(screen.getByPlaceholderText('版本 1')).toBeVisible()

    fireEvent.click(workTab)
    expect(screen.getByLabelText('书名')).toBeVisible()
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

  it('resets version metadata to file metadata via ConfirmDialog', async () => {
    renderDialog()
    const versionTab = screen.getByRole('button', { name: /版本 1/ })
    fireEvent.click(versionTab)

    const resetBtn = screen.getByRole('button', { name: '重置为文件元数据' })
    expect(resetBtn).toBeInTheDocument()

    fireEvent.click(resetBtn)

    // Confirm dialog should be open as an alertdialog
    const confirmDialog = await screen.findByRole('alertdialog')
    expect(confirmDialog).toBeInTheDocument()
    const confirmBtn = within(confirmDialog).getByRole('button', { name: '重置为文件元数据' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(resetVersionMetadata).toHaveBeenCalledWith({
      libraryId: 'lib_city',
      libraryBookId: 'lb1',
      versionLinkId: 'lbv1',
    }))
  })
})
