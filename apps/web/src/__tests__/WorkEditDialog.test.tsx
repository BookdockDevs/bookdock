import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import i18n from '../i18n/i18n'
import WorkEditDialog from '../features/library/components/WorkEditDialog'
import type { CatalogBook } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useLibraryCategories: vi.fn(),
  useLibraryTags: vi.fn(),
  useUpdateCatalogBook: vi.fn(),
  useUpdateCatalogVersion: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
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

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useLibraryCategories.mockReturnValue({ data: { data: [{ id: 'cat1', name: '小说' }, { id: 'cat2', name: '散文' }] } })
    HOOKS.useLibraryTags.mockReturnValue({ data: { data: [{ id: 't1', name: 'classic' }, { id: 't2', name: 'new' }] } })
    HOOKS.useUpdateCatalogBook.mockReturnValue({ mutateAsync: updateBook, isPending: false })
    HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutateAsync: updateVersion, isPending: false })
  })

  function renderDialog(target = work()) {
    const first = target.versions.find((v) => v.id === 'lbv1') ?? target.versions[0]!
    render(
      <WorkEditDialog
        work={target}
        libraryId="lib_city"
        version={first}
        versionIndex={target.versions.indexOf(first)}
        onClose={vi.fn()}
      />,
    )
  }

  it('edits the work and the visible version in one save', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'City Book 2' } })
    fireEvent.change(screen.getByPlaceholderText('第1版'), { target: { value: '精校版' } })

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
    // The title override starts unfollowed; checking follow sends null.
    const follows = screen.getAllByRole('checkbox', { name: '跟随作品' })
    expect(follows[0]).not.toBeChecked()
    fireEvent.click(follows[0]!)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { title: null },
    }))
    expect(updateBook).not.toHaveBeenCalled()
  })
})
