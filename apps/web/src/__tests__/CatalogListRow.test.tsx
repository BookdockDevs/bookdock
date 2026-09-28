import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import type { MouseEvent, ReactNode } from 'react'

import i18n from '../i18n/i18n'
import CatalogListRow from '../features/library/components/CatalogListRow'
import { useUiStore } from '@/stores/ui.store'
import type { CatalogBook } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useUpdateCatalogVersion: vi.fn(),
  useDeleteCatalogVersion: vi.fn(),
  useLibraryCategories: vi.fn(),
  useCollectBook: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, onClick, className }: {
    to: string
    params?: { id?: string }
    children?: ReactNode
    onClick?: (e: MouseEvent) => void
    className?: string
  }) => (
    <a href={to === '/books/$id' && params?.id ? `/books/${params.id}` : to} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: '', coverKey: null, bookmeta: {}, fileName: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, pinnedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'City Book', author: 'Someone',
    description: '', coverKey: null, tags: [], versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function renderRow(target: CatalogBook, opts: { selectionActive?: boolean; selected?: boolean; selection?: Set<string>; canManage?: boolean; canCollect?: boolean } = {}) {
  const onToggleSelect = vi.fn()
  const onShowDetails = vi.fn()
  const updateVersion = vi.fn()
  const deleteVersion = vi.fn()
  const collect = vi.fn()
  HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutate: updateVersion })
  HOOKS.useDeleteCatalogVersion.mockReturnValue({ mutate: deleteVersion })
  HOOKS.useLibraryCategories.mockReturnValue({ data: { data: [{ id: 'cat-1', name: '小说分类' }] }, isLoading: false })
  HOOKS.useCollectBook.mockReturnValue({ mutate: collect, isPending: false })
  render(
    <DndContext>
      <CatalogListRow
        work={target}
        canManage={opts.canManage ?? false}
        canCollect={opts.canCollect ?? true}
        selected={opts.selected ?? false}
        selectionActive={opts.selectionActive ?? false}
        selection={opts.selection ?? new Set()}
        dragJustEndedRef={{ current: false }}
        onToggleSelect={onToggleSelect}
        onShowDetails={onShowDetails}
      />
    </DndContext>,
  )
  return { onToggleSelect, onShowDetails, updateVersion, deleteVersion, collect }
}

/**
 * A shared library's list view draws rows, not cards: the same work data and
 * the same selection/drag rules as the grid card, only the row chrome of a
 * private list row.
 */
describe('CatalogListRow', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('reads the first version on click, like a private row reads its book', () => {
    const { onShowDetails, onToggleSelect } = renderRow(work())
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.getByText('Someone')).toBeInTheDocument()
    expect(screen.queryByText('1 个版本')).toBeNull()
    expect(screen.getByText('City Book').closest('a')).toHaveAttribute('href', '/books/v1')
    fireEvent.click(screen.getByText('City Book'))
    expect(onShowDetails).not.toHaveBeenCalled()
    expect(onToggleSelect).not.toHaveBeenCalled()
  })

  it('does not show a version count for works with several versions', () => {
    renderRow(work({ versions: [version(), version({ id: 'lbv2', bookVersionId: 'v2' })] }))
    expect(screen.queryByText('2 个版本')).toBeNull()
  })

  it('toggles selection instead of navigating in selection mode', () => {
    const { onShowDetails, onToggleSelect } = renderRow(work(), { selectionActive: true })
    fireEvent.click(screen.getByText('City Book'))
    expect(onToggleSelect).toHaveBeenCalledWith('lb1', false)
    expect(onShowDetails).not.toHaveBeenCalled()
  })

  it('offers the same menu as the grid card: details and download, nothing managerial', () => {
    renderRow(work())
    fireEvent.contextMenu(screen.getByText('City Book'))
    expect(screen.getByText('详情')).toBeInTheDocument()
    expect(screen.getByText('下载')).toBeInTheDocument()
    expect(screen.getByText('加入我的书库')).toBeInTheDocument()
    expect(screen.queryByText('置顶')).toBeNull()
    expect(screen.queryByText('删除')).toBeNull()
  })

  it('hides collect when the first version is already in the private library', () => {
    renderRow(work({ versions: [version({ collected: true })] }))
    fireEvent.contextMenu(screen.getByText('City Book'))
    expect(screen.queryByText('加入我的书库')).not.toBeInTheDocument()
  })

  it('triggers collect through the menu item when clicked', () => {
    const { collect } = renderRow(work(), { canCollect: true })
    fireEvent.contextMenu(screen.getByText('City Book'))
    fireEvent.click(screen.getByText('加入我的书库'))
    expect(collect).toHaveBeenCalledWith(
      { libraryId: 'lib_city', versionLinkId: 'lbv1' },
      expect.any(Object),
    )
  })

  it('pins through the manager-only menu item', () => {
    const { updateVersion } = renderRow(work(), { canManage: true })
    fireEvent.contextMenu(screen.getByText('City Book'))
    fireEvent.click(screen.getByText('置顶'))
    expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { pinned: true },
    }))
  })

  it('shows the same info line as a private row: category, tags, size, date', () => {
    useUiStore.setState({ listInfoItems: ['shelf', 'tags', 'size', 'createdAt'] })
    try {
      renderRow(work({ categoryId: 'cat-1', tags: [{ id: 't1', name: '科幻' }] }))
      expect(screen.getByText('小说分类')).toBeInTheDocument()
      expect(screen.getByText('科幻')).toBeInTheDocument()
      expect(screen.getByText('10 B')).toBeInTheDocument()
    } finally {
      useUiStore.setState({ listInfoItems: ['progress'] })
    }
  })

  it('renders unpin button in title for managers when pinned', () => {
    const { updateVersion } = renderRow(work({ versions: [version({ pinnedAt: 99 })] }), { canManage: true })
    const unpinBtn = screen.getByLabelText('取消置顶')
    expect(unpinBtn).toBeInTheDocument()
    fireEvent.click(unpinBtn)
    expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({ patch: { pinned: false } }))
  })

  it('renders read-only pin indicator in title for members without unpin affordance', () => {
    renderRow(work({ versions: [version({ pinnedAt: 99 })] }), { canManage: false })
    expect(screen.getByLabelText('置顶')).toBeInTheDocument()
    expect(screen.queryByLabelText('取消置顶')).toBeNull()
  })
})
