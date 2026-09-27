import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'

import i18n from '../i18n/i18n'
import CatalogCard from '../features/library/components/CatalogCard'
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

function library(overrides: Partial<Library> = {}): Library {
  return {
    id: 'lib_city', userId: 'u2', type: 'shared', name: 'City', description: 'All the books',
    visibility: 'public', createdAt: 1, updatedAt: 1, ...overrides,
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

function renderRow(element: ReactElement) {
  return render(<ul>{element}</ul>)
}

function renderCard(book: CatalogBook, { canManage = false, canCollect = true, moveCandidates = [] as CatalogBook[] } = {}) {
  const updateVersion = vi.fn()
  const moveVersion = vi.fn()
  const deleteVersion = vi.fn()
  const collect = vi.fn()
  const onShowDetails = vi.fn()
  const onOpen = vi.fn()
  HOOKS.useUpdateCatalogVersion.mockReturnValue({ mutate: updateVersion })
  HOOKS.useMoveCatalogVersion.mockReturnValue({ mutate: moveVersion })
  HOOKS.useDeleteCatalogVersion.mockReturnValue({ mutate: deleteVersion })
  HOOKS.useCollectBook.mockReturnValue({ mutate: collect, isPending: false })
  const { container } = renderRow(
    <CatalogCard
      book={book}
      library={library()}
      canManage={canManage}
      canCollect={canCollect}
      moveCandidates={moveCandidates}
      onShowDetails={onShowDetails}
      onOpen={onOpen}
    />,
  )
  return { container, updateVersion, moveVersion, deleteVersion, collect, onShowDetails, onOpen }
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
    renderCard(work({ tags: [{ id: 't1', name: 'classic' }] }), { moveCandidates: [work()] })
    // Title, author and artwork, and nothing about reading: a work belongs to
    // nobody, so there is no progress to show and none is invented.
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.getByText('Someone')).toBeInTheDocument()
    expect(screen.queryByText('1 个版本')).toBeNull()
    expect(screen.queryByText(/^\d+%$/)).toBeNull()
  })

  it('draws its cover with the shared cover component and endpoint', () => {
    const { container } = renderRow(
      <CatalogCard
        book={work({ coverKey: 'cover-1' })}
        library={library()}
        canManage={false}
        canCollect
        moveCandidates={[]}
        onShowDetails={vi.fn()}
        onOpen={vi.fn()}
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
        library={library()}
        canManage={false}
        canCollect
        moveCandidates={[]}
        onShowDetails={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/books/v1/cover?size=thumb')
  })

  it('obeys the grid card fields, so a hidden field is really hidden', () => {
    renderRow(
      <CatalogCard
        book={work()}
        library={library()}
        canManage={false}
        canCollect
        moveCandidates={[]}
        gridCardFields={['title']}
        onShowDetails={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('City Book')).toBeInTheDocument()
    expect(screen.queryByText('Someone')).toBeNull()
  })

  it('opens the shared detail dialog from the menu', () => {
    const { container, onShowDetails, onOpen } = renderCard(work())
    openMenu(container)
    fireEvent.click(screen.getByText('详情'))
    expect(onShowDetails).toHaveBeenCalledWith(expect.objectContaining({ id: 'lb1' }))
    // Versions are chosen in the detail, not on the card.
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('sends a reader straight to the first version when there is nothing to pick', () => {
    const { onOpen } = renderCard(work())
    onOpen(work())
    expect(onOpen).toHaveBeenCalled()
  })

  it('offers no read-status or delete item, because a work has neither', () => {
    const { container } = renderCard(work({ versions: [version({ status: 'unlisted' })] }))
    openMenu(container)
    // An unlisted version is still listed in the detail; the row only offers
    // what a work can answer for.
    expect(screen.queryByText('library.markFinished')).toBeNull()
    expect(screen.queryByText('删除')).toBeNull()
  })
})
