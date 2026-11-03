import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPost, apiUpload } from '@/api/client'
import ReadingImportDialog from '../ReadingImportDialog'

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {},
  apiPost: vi.fn(),
  apiUpload: vi.fn(),
}))

let mockWereadConfigured = true

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    data: { data: { weread: mockWereadConfigured } },
    isSuccess: true,
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('../WereadWebLoginControls', () => ({ default: () => <div /> }))

const list = {
  source: 'weread' as const,
  scope: 'all' as const,
  items: [
    { bookKey: 'bk-1', title: 'Example', author: 'Author', coverUrl: null, status: 'new' as const, notes: 2, reviews: 0, durationFacts: 3, selectable: true },
    // Already imported and empty in this scope: visible, but not selectable.
    { bookKey: 'bk-2', title: 'Greyed', author: null, coverUrl: null, status: 'imported' as const, notes: 0, reviews: 0, durationFacts: 0, selectable: false },
  ],
  skipped: 0,
  unprocessable: [],
}

const preview = {
  previewId: 'preview-one',
  ...list,
}

const result = {
  source: 'weread' as const,
  scope: 'all' as const,
  books: { new: 1, updated: 0 },
  notes: { new: 2, updated: 0, unchanged: 0 },
  reviews: { new: 0, updated: 0, unchanged: 0 },
  durationFacts: { new: 3, updated: 0, unchanged: 0 },
  skipped: 0,
  unprocessable: [],
  conflicts: [],
}

/** A re-import where both sides changed one highlight. */
const conflictedResult = {
  ...result,
  notes: { new: 0, updated: 0, unchanged: 0 },
  conflicts: [{
    key: 'conflict-key',
    kind: 'highlight' as const,
    incomingText: 'Source version',
    localText: 'My edited version',
    chapter: 'Chapter one',
    bookKey: 'bk-1',
  }],
}

function mockPosts(overrides: Record<string, unknown> = {}) {
  vi.mocked(apiPost).mockImplementation(async (path: string) => {
    if (path.endsWith('/weread/books')) return { data: overrides.books ?? list } as never
    if (path.endsWith('/weread/preview')) return { data: overrides.preview ?? preview } as never
    if (path.endsWith('/weread/import')) return { data: overrides.import ?? result } as never
    if (path.endsWith('/legado/import')) return { data: { ...result, source: 'legado' } } as never
    throw new Error(`unexpected request ${path}`)
  })
}

describe('ReadingImportDialog', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockPosts()
  })

  it('stays idle until the reader explicitly requests the book list', async () => {
    render(<ReadingImportDialog onClose={vi.fn()} />)

    expect(screen.queryByLabelText('Example')).toBeNull()
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.queryByRole('radiogroup', { name: 'readingImport.scopeLabel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))

    await screen.findByLabelText('Example')
    expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/books', { channel: 'skill', scope: 'all' })
    // Nothing starts ticked, so the user picks what to fetch and import.
    expect(screen.getByLabelText('Example')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('button', { name: 'readingImport.confirmImport' })).toBeDisabled()
  })

  it('fetches only the ticked books, then imports that snapshot', async () => {
    const onClose = vi.fn()
    render(<ReadingImportDialog onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    expect(screen.getByLabelText('Greyed')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByLabelText('Example'))
    expect(screen.getByLabelText('Example')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.confirmImport' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/preview', {
      channel: 'skill',
      scope: 'all',
      bookKeys: ['bk-1'],
    }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/import', {
      previewId: 'preview-one',
      bookKeys: ['bk-1'],
    }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a locally edited record in a conflict notice modal and dismisses on confirm', async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      if (path.endsWith('/weread/books')) return { data: list } as never
      if (path.endsWith('/weread/preview')) return { data: preview } as never
      if (path.endsWith('/weread/import')) return { data: conflictedResult } as never
      throw new Error(`unexpected request ${path}`)
    })
    render(<ReadingImportDialog onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    fireEvent.click(screen.getByLabelText('Example'))
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.confirmImport' }))

    // Conflict notice modal is shown with both versions preserved locally
    expect(await screen.findByText('My edited version')).toBeInTheDocument()
    expect(screen.getByText(/Source version/)).toBeInTheDocument()
    expect(screen.getByText('readingImport.conflictsTitle')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: 'readingImport.confirm' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.queryByText('My edited version')).toBeNull())
  })

  it('updates selected state and button label when books are clicked', async () => {
    render(<ReadingImportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')

    const exampleItem = screen.getByLabelText('Example')
    expect(exampleItem).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(exampleItem)
    expect(exampleItem).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'readingImport.confirmImport' })).not.toBeDisabled()

    fireEvent.click(exampleItem)
    expect(exampleItem).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('button', { name: 'readingImport.confirmImport' })).toBeDisabled()
  })

  it('uploads Legado once for preview, then confirms with its snapshot id', async () => {
    vi.mocked(apiUpload).mockResolvedValueOnce({ data: { ...preview, source: 'legado' } })
    const file = new File(['zip fixture'], 'backup.zip', { type: 'application/zip' })

    render(<ReadingImportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'readingImport.sourceLegado' }))
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    fireEvent.click(screen.getByLabelText('Example'))
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.confirmImport' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/legado/import', {
      previewId: 'preview-one',
      bookKeys: ['bk-1'],
    }))
    expect(apiUpload).toHaveBeenCalledOnce()
    expect(apiUpload).toHaveBeenCalledWith('/reading-imports/legado/preview?scope=all', file)
  })

  it('shows scopes only for Web and Legado in preview, while Skill stays unscoped', async () => {
    render(<ReadingImportDialog onClose={vi.fn()} />)
    expect(screen.queryByText('readingImport.scopeAll')).toBeNull()
    expect(screen.queryByText('readingImport.scopeNotes')).toBeNull()
    expect(screen.queryByText('readingImport.scopeTime')).toBeNull()

    // Skill preview: unscoped
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    expect(screen.queryByText('readingImport.scopeAll')).toBeNull()

    // Return to config
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.backToConfig' }))

    // Web channel preview: scoped
    fireEvent.click(screen.getByRole('tab', { name: 'readingImport.wereadWeb' }))
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    expect(screen.getByText('readingImport.scopeAll')).toBeTruthy()
    expect(screen.getByText('readingImport.scopeNotes')).toBeTruthy()
    expect(screen.getByText('readingImport.scopeTime')).toBeTruthy()
  })

  it('treats mounted books as imported in the filter', async () => {
    mockPosts({ books: { ...list, items: [{ ...list.items[0], status: 'mounted' as const }] } })
    render(<ReadingImportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    const imported = screen.getByRole('tab', { name: /readingImport.statusImported/ })
    expect(imported.textContent).toContain('1')
    fireEvent.click(imported)
    expect(screen.getByLabelText('Example')).toBeTruthy()
  })

  it('uses the Web channel for a selected time-only import and confirms it normally', async () => {
    render(<ReadingImportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'readingImport.wereadWeb' }))
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')
    fireEvent.click(screen.getByText('readingImport.scopeTime'))
    fireEvent.click(screen.getByLabelText('Example'))
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.confirmImport' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/preview', {
      channel: 'web',
      scope: 'time',
      bookKeys: ['bk-1'],
    }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/import', {
      previewId: 'preview-one',
      bookKeys: ['bk-1'],
    }))
    expect(apiPost).not.toHaveBeenCalledWith('/reading-imports/weread/durations/sync', expect.anything())
  })

  it('supports returning from book list preview back to config page and verifies lazy image cover', async () => {
    mockPosts({
      books: {
        ...list,
        items: [
          {
            bookKey: 'bk-cover',
            title: 'Book With Cover',
            author: 'Cover Author',
            coverUrl: 'https://weread.test/cover.jpg',
            status: 'new',
            notes: 1,
            reviews: 0,
            durationFacts: 0,
            selectable: true,
          },
        ],
      },
    })
    render(<ReadingImportDialog onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'readingImport.sourceWeread' })).toBeInTheDocument()

    // 1. 进入选书预览子页
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Book With Cover')

    // 2. 检查封面具有懒加载及防盗链属性，且配置页卡片已隐藏
    const img = screen.getByRole('img', { name: 'Book With Cover' })
    expect(img).toHaveAttribute('src', 'https://weread.test/cover.jpg')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.queryByRole('tab', { name: 'readingImport.sourceWeread' })).toBeNull()

    // 3. 点击返回配置
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.backToConfig' }))
    expect(screen.getByRole('tab', { name: 'readingImport.sourceWeread' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Book With Cover')).toBeNull()
  })

  it('supports single-book direct import using the action button on item row', async () => {
    render(<ReadingImportDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'readingImport.preview' }))
    await screen.findByLabelText('Example')

    // Find the single action button on Example item (status: 'new' -> actionImport)
    const importBtn = screen.getByRole('button', { name: 'readingImport.actionImport' })
    expect(importBtn).toBeInTheDocument()

    fireEvent.click(importBtn)

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/preview', {
      channel: 'skill',
      scope: 'all',
      bookKeys: ['bk-1'],
    }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/reading-imports/weread/import', {
      previewId: 'preview-one',
      bookKeys: ['bk-1'],
    }))
  })

  it('disables preview and shows warning when skill API key is not configured', () => {
    mockWereadConfigured = false
    render(<ReadingImportDialog onClose={vi.fn()} />)
    expect(screen.getByText('readingImport.wereadSkillUnconfigured')).toBeInTheDocument()
    const previewBtn = screen.getByRole('button', { name: 'readingImport.preview' })
    expect(previewBtn).toBeDisabled()
    mockWereadConfigured = true
  })

  it('persists and restores source and wereadChannel from localStorage', () => {
    localStorage.setItem('bd-reading-import-source', 'legado')
    const { unmount } = render(<ReadingImportDialog onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'readingImport.sourceLegado' })).toHaveAttribute('aria-selected', 'true')
    unmount()

    localStorage.setItem('bd-reading-import-source', 'weread')
    localStorage.setItem('bd-reading-import-weread-channel', 'web')
    const second = render(<ReadingImportDialog onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'readingImport.sourceWeread' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'readingImport.wereadWeb' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'readingImport.sourceLegado' }))
    expect(localStorage.getItem('bd-reading-import-source')).toBe('legado')
    second.unmount()
  })
})
