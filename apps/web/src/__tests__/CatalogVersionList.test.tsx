import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import i18n from '../i18n/i18n'
import CatalogVersionList from '../features/library/components/CatalogVersionList'
import type { CatalogBook, Library } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useUpdateCatalogVersion: vi.fn(),
  useMoveCatalogVersion: vi.fn(),
  useDeleteCatalogVersion: vi.fn(),
  useCollectBook: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

function library(): Library {
  return {
    id: 'lib_city', userId: 'u2', type: 'shared', name: 'City', description: '',
    visibility: 'public', createdAt: 1, updatedAt: 1,
  }
}

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: '', coverKey: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'City Book', author: 'Someone',
    description: '', coverKey: null, tags: [], versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function renderList(target: CatalogBook, { canManage = false, canCollect = true, moveCandidates = [] as CatalogBook[] } = {}) {
  const updateVersion = vi.fn()
  const moveVersion = vi.fn()
  const deleteVersion = vi.fn()
  const collect = vi.fn()
  HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutate: updateVersion })
  HOOKS.useMoveCatalogVersion.mockReturnValue({ mutate: moveVersion })
  HOOKS.useDeleteCatalogVersion.mockReturnValue({ mutate: deleteVersion })
  HOOKS.useCollectBook.mockReturnValue({ mutate: collect, isPending: false })
  render(
    <ul>
      <CatalogVersionList work={target} library={library()} canManage={canManage} canCollect={canCollect} moveCandidates={moveCandidates} />
    </ul>,
  )
  return { updateVersion, moveVersion, deleteVersion, collect }
}

/**
 * A work is a set of versions: a reader picks one to read and a curator
 * publishes, moves or removes one. The list moved from the card's row into the
 * work's detail (the design puts it there), so this is where its behaviour is
 * pinned.
 */
describe('CatalogVersionList', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('opens a version in the reader without a private card', () => {
    renderList(work())
    fireEvent.click(screen.getByText('阅读'))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/books/$id', params: { id: 'v1' } })
  })

  it('collects a version and reports the real outcome on repeats', () => {
    const { collect } = renderList(work())
    const verdicts = [false, true]
    collect.mockImplementation((_vars: unknown, opts: { onSuccess: (res: { data: { alreadyExists: boolean } }) => void }) => {
      opts.onSuccess({ data: { alreadyExists: verdicts.shift() ?? false } })
    })

    fireEvent.click(screen.getByText('加入我的书库'))
    expect(collect).toHaveBeenCalledWith(
      { libraryId: 'lib_city', versionLinkId: 'lbv1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    // The server verdict, not the UI, decides which message the reader sees.
    expect(screen.getByText('已在书库中')).toBeInTheDocument()
    fireEvent.click(screen.getByText('已在书库中'))
    expect(collect).toHaveBeenCalledTimes(2)
  })

  it('gives managers publish, move and delete on a version', () => {
    const { updateVersion, moveVersion, deleteVersion } = renderList(work(), {
      canManage: true,
      moveCandidates: [work({ id: 'lb2', title: 'Other Book' })],
    })

    fireEvent.click(screen.getByText('下架'))
    expect(updateVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { status: 'unlisted' },
    })

    fireEvent.change(screen.getByLabelText('移动到…'), { target: { value: 'lb2' } })
    expect(moveVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', targetLibraryBookId: 'lb2',
    })

    fireEvent.click(screen.getByText('删除版本'))
    expect(deleteVersion).toHaveBeenCalledWith({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1',
    })
  })

  it('hides the catalog controls from anyone who is not a manager', () => {
    const { updateVersion } = renderList(work({ versions: [version({ status: 'unlisted' })] }), {
      canManage: false,
      moveCandidates: [work({ id: 'lb2' })],
    })
    // An unlisted version is still shown, flagged - but never openable: the
    // backend rejects it and there is no manager preview.
    expect(screen.getByText('已下架')).toBeInTheDocument()
    expect(screen.queryByText('下架')).not.toBeInTheDocument()
    expect(screen.queryByText('删除版本')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('移动到…')).not.toBeInTheDocument()
    expect(updateVersion).not.toHaveBeenCalled()
  })

  it('disables reading an unlisted version even for managers', () => {
    renderList(work({ versions: [version({ status: 'unlisted' })] }), { canManage: true })
    const read = screen.getByText('阅读')
    expect(read).toBeDisabled()
    fireEvent.click(read)
    expect(navigateMock).not.toHaveBeenCalled()
    // Publishing stays available: that is how the version becomes readable.
    expect(screen.getByText('上架')).toBeInTheDocument()
  })

  it('offers no move picker when the page holds no other work', () => {
    renderList(work(), { canManage: true, moveCandidates: [] })
    expect(screen.queryByLabelText('移动到…')).not.toBeInTheDocument()
  })
})
