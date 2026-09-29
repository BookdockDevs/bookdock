import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

import i18n from '../i18n/i18n'
import CatalogCard from '../features/library/components/CatalogCard'
import type { CatalogBook } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useUpdateCatalogVersion: vi.fn(),
  useUpdateCatalogBook: vi.fn(),
  useMoveCatalogVersion: vi.fn(),
  useDeleteCatalogVersion: vi.fn(),
  useCollectBook: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

function version(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
  return {
    id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
    name: '', title: null, author: null, description: null, coverKey: null,
    effective: { title: 'City Book', author: 'Someone', description: '', coverKey: null, bookmeta: {}, fileName: null },
    format: 'epub', size: 10, chapterCount: 3, wordCount: 100, guestReadable: false, pinnedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

function work(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'City Book', author: 'Someone',
    description: '', coverKey: null, pinnedAt: null, tags: [], versions: [version()], createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function renderRow(element: ReactElement) {
  return render(<ul>{element}</ul>)
}

function renderCard(book: CatalogBook, { canManage = false, canCollect = true } = {}) {
  const updateVersion = vi.fn()
  const updateBook = vi.fn()
  const moveVersion = vi.fn()
  const deleteVersion = vi.fn()
  const collect = vi.fn()
  const onShowDetails = vi.fn()
  HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutate: updateVersion })
  HOOKS.useUpdateCatalogBook.mockReturnValue({ mutate: updateBook })
  HOOKS.useMoveCatalogVersion.mockReturnValue({ mutate: moveVersion })
  HOOKS.useDeleteCatalogVersion.mockReturnValue({ mutate: deleteVersion, mutateAsync: deleteVersion })
  HOOKS.useCollectBook.mockReturnValue({ mutate: collect, isPending: false })
  const { container } = renderRow(
    <CatalogCard
      book={book}
      canManage={canManage}
      canCollect={canCollect}
      onShowDetails={onShowDetails}
    />,
  )
  return { container, updateVersion, updateBook, moveVersion, deleteVersion, collect, onShowDetails }
}

/** Opens the row's overflow menu, the way a reader does. */
function openMenu(container: HTMLElement) {
  fireEvent.contextMenu(container.querySelector('article')!)
}

describe('CatalogCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
  })

  it('draws the work with the same card a private book uses', () => {
    renderCard(work({ tags: [{ id: 't1', name: 'classic' }] }))
    // Title, author and artwork, and nothing about reading: a work belongs to
    // nobody, so there is no progress to show and none is invented.
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.getByText('Someone')).toBeInTheDocument()
    expect(screen.queryByText('1 个版本')).toBeNull()
    expect(screen.queryByText(/^\d+%$/)).toBeNull()
  })

  it('shows independent work and hidden-version indicators on a multi-version card', () => {
    renderCard(work({
      hidden: true,
      versions: [version(), version({ id: 'lbv2', bookVersionId: 'v2', status: 'unlisted' })],
    }))
    expect(screen.getByRole('img', { name: '作品已隐藏' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '含隐藏版本' })).toBeInTheDocument()
  })

  it('draws its cover with the shared cover component and endpoint', () => {
    const { container } = renderRow(
      <CatalogCard
        book={work({ coverKey: 'cover-1' })}
        canManage={false}
        canCollect
        onShowDetails={vi.fn()}
      />,
    )
    const img = container.querySelector('img')!
    // Same URL shape and same component as a private book card, so the two
    // libraries cannot drift on how artwork is fetched or shown.
    expect(img.getAttribute('src')).toBe('/api/v1/books/v1/cover?size=thumb')
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('still asks for artwork when the work has no cover of its own', () => {
    const { container } = renderRow(
      <CatalogCard
        book={work({ coverKey: null })}
        canManage={false}
        canCollect
        onShowDetails={vi.fn()}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/books/v1/cover?size=thumb')
  })

  it('shows the title placeholder at once for a coverless txt, with no doomed fetch', () => {
    const { container } = renderRow(
      <CatalogCard
        book={work({ coverKey: null, versions: [version({ format: 'txt' })] })}
        canManage={false}
        canCollect
        onShowDetails={vi.fn()}
      />,
    )
    // No artwork can exist, so no request is issued: the placeholder title is
    // already on screen instead of arriving with the cover 404.
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getAllByText('City Book')).toHaveLength(2)
  })

  it('obeys the selected card fields and never renders progress', () => {
    renderRow(
      <CatalogCard
        book={work()}
        canManage={false}
        canCollect
        gridCardFields={['title']}
        onShowDetails={vi.fn()}
      />,
    )
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.queryByText('Someone')).toBeNull()
    expect(screen.queryByText(/^\d+%$/)).toBeNull()
  })

  it('opens the shared detail dialog from the menu', () => {
    const { container, onShowDetails } = renderCard(work())
    openMenu(container)
    fireEvent.click(screen.getByText('详情'))
    expect(onShowDetails).toHaveBeenCalledWith(expect.objectContaining({ id: 'lb1' }))
  })

  it('keeps version picking out of the menu', () => {
    const { container } = renderCard(work(), { canManage: true })
    openMenu(container)
    expect(screen.queryByText('版本')).toBeNull()
  })

  it('offers details and download to a reader, nothing managerial', () => {
    const { container } = renderCard(work())
    openMenu(container)
    expect(screen.getByText('详情')).toBeInTheDocument()
    expect(screen.getByText('下载')).toBeInTheDocument()
    expect(screen.queryByText('置顶')).toBeNull()
    expect(screen.queryByText('删除')).toBeNull()
  })

  it('offers collect to a reader in the menu when canCollect is true', () => {
    const { container, collect } = renderCard(work(), { canCollect: true })
    openMenu(container)
    expect(screen.getByText('加入我的书库')).toBeInTheDocument()
    fireEvent.click(screen.getByText('加入我的书库'))
    expect(collect).toHaveBeenCalledWith(
      { libraryId: 'lib_city', versionLinkId: 'lbv1' },
      expect.any(Object),
    )
  })

  it('hides collect when the first version is already in the private library', () => {
    const { container } = renderCard(work({ versions: [version({ collected: true })] }))
    openMenu(container)
    expect(screen.queryByText('加入我的书库')).not.toBeInTheDocument()
  })

  it('does not display version count for single or multi-version works', () => {
    renderCard(work())
    expect(screen.queryByText(/个版本/)).not.toBeInTheDocument()
    renderCard(work({ versions: [version(), version({ id: 'lbv2', bookVersionId: 'v2' })] }))
    expect(screen.queryByText(/个版本/)).not.toBeInTheDocument()
  })

  it('withholds download for an unlisted version the server would refuse', () => {
    const { container } = renderCard(work({ versions: [version({ status: 'unlisted' })] }))
    openMenu(container)
    expect(screen.getByText('详情')).toBeInTheDocument()
    expect(screen.queryByText('下载')).toBeNull()
  })

  it('pins and deletes through the manager-only items', () => {
    const { container, updateBook, deleteVersion } = renderCard(work(), { canManage: true })
    openMenu(container)
    fireEvent.click(screen.getByText('置顶'))
    expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'lib_city', libraryBookId: 'lb1', patch: { pinned: true },
    }))
    // Deleting the last version removes the whole work: confirmed first.
    openMenu(container)
    fireEvent.click(screen.getByText('删除'))
    expect(deleteVersion).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/删除后整个作品会被移除/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(deleteVersion).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1' })
  })

  it('preselects every version when deleting a multi-version work from the menu', async () => {
    const { container, deleteVersion } = renderCard(
      work({ versions: [version(), version({ id: 'lbv2', bookVersionId: 'v2' })] }),
      { canManage: true },
    )
    openMenu(container)
    fireEvent.click(screen.getByText('删除'))
    const dialog = screen.getByRole('alertdialog')
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes.every((box) => box.checked)).toBe(true)
    fireEvent.click(boxes[0]!)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledTimes(1))
    expect(deleteVersion).toHaveBeenCalledWith(
      { libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv2' },
    )
  })

  it('offers unpin when the work is already pinned', () => {
    const { container, updateBook } = renderCard(work({ pinnedAt: 99 }), { canManage: true })
    openMenu(container)
    fireEvent.click(screen.getByText('取消置顶'))
    expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({ patch: { pinned: false } }))
  })

  it('offers no read-status item, because a work has none', () => {
    const { container } = renderCard(work({ versions: [version({ status: 'unlisted' })] }))
    openMenu(container)
    // An unlisted version is still listed in the detail; the row only offers
    // what a work can answer for.
    expect(screen.queryByText('library.markFinished')).toBeNull()
  })

  it('renders unpin button on the card for managers when pinned', () => {
    const { updateBook } = renderCard(work({ pinnedAt: 99 }), { canManage: true })
    const unpinBtn = screen.getByLabelText('取消置顶')
    expect(unpinBtn).toBeInTheDocument()
    fireEvent.click(unpinBtn)
    expect(updateBook).toHaveBeenCalledWith(expect.objectContaining({ patch: { pinned: false } }))
  })

  it('renders read-only pin indicator on the card for members without unpin affordance', () => {
    renderCard(work({ pinnedAt: 99 }), { canManage: false })
    expect(screen.getByLabelText('置顶')).toBeInTheDocument()
    expect(screen.queryByLabelText('取消置顶')).toBeNull()
  })
})
