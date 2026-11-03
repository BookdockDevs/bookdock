import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookListItem, ReadingImportLocatorReport, ReadingImportMountResult } from '@bookdock/shared'

import { apiGet, apiPost } from '@/api/client'
import ImportLocatorDialog from '../ImportLocatorDialog'

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {},
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

const books = [
  { id: 'bv-target', title: '机器人大战', author: '也闲', format: 'epub' },
  { id: 'bv-other', title: '另一本', author: '', format: 'txt' },
]

const report: ReadingImportLocatorReport = {
  archiveId: 'arc-1',
  targetBookVersionId: 'bv-target',
  targetRevisionId: 'rev-1',
  chapters: 249,
  total: 4,
  located: 1,
  ambiguous: 1,
  missing: 1,
  conflict: 1,
  warnings: { punctuation: 1, crossParagraph: 0, chapterMismatch: 0 },
  items: [
    { recordId: 'r1', kind: 'highlight', text: '黑暗森林', state: 'located', hits: 1, chapter: '第一章', sourceChapter: '第一章', warning: 'punctuation', reason: null, cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)' },
    { recordId: 'r2', kind: 'highlight', text: '他说', state: 'ambiguous', hits: 3, chapter: null, sourceChapter: null, warning: null, reason: null, cfiRange: null },
    { recordId: 'r3', kind: 'idea', text: '不存在的句子', state: 'missing', hits: 0, chapter: null, sourceChapter: null, warning: null, reason: 'not-found', cfiRange: null },
    { recordId: 'r4', kind: 'highlight', text: '已有划线', state: 'conflict', hits: 1, chapter: '第二章', sourceChapter: '第二章', warning: null, reason: null, cfiRange: null },
  ],
}

function renderDialog(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <ImportLocatorDialog archiveId="arc-1" archiveTitle="机器人大战" onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('ImportLocatorDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports positions against the chosen target book and never writes', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: books as unknown as BookListItem[] })
    vi.mocked(apiPost).mockResolvedValue({ data: report })

    renderDialog()

    // The target is an ordinary book of the reader's own shelf.
    fireEvent.click(await screen.findByText('机器人大战'))

    // The report replaces the picker: 5 metric filter cards are shown
    expect(await screen.findByText('readingImport.filterAll')).toBeTruthy()
    expect(screen.getAllByText('readingImport.locatorLocated').length).toBeGreaterThan(0)
    expect(screen.getAllByText('readingImport.locatorMissing').length).toBeGreaterThan(0)
    expect(apiPost).toHaveBeenCalledWith('/reading-imports/archives/arc-1/locator-report', { targetBookVersionId: 'bv-target' })
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(screen.getByText('黑暗森林')).toBeTruthy()

    // Missing metric card filters to missing rows only.
    const missingTab = screen.getAllByRole('tab')[3]
    fireEvent.click(missingTab)
    await waitFor(() => expect(screen.queryByText('黑暗森林')).toBeNull())
    expect(screen.getByText('不存在的句子')).toBeTruthy()
  })

  it('switching the target re-asks for a report instead of reusing the old one', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: books as unknown as BookListItem[] })
    vi.mocked(apiPost).mockResolvedValue({ data: report })

    renderDialog()
    fireEvent.click(await screen.findByText('机器人大战'))
    await screen.findByText('readingImport.filterAll')

    fireEvent.click(screen.getByText('readingImport.locatorChangeTarget'))
    fireEvent.click(await screen.findByText('另一本'))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/reading-imports/archives/arc-1/locator-report',
      { targetBookVersionId: 'bv-other' },
    ))
  })

  it('invalidates the target book caches a mount rewrites', async () => {
    const mountResult: ReadingImportMountResult = {
      archiveId: 'arc-1',
      targetBookVersionId: 'bv-target',
      notes: { migrated: 39, positioned: 38, unpositioned: 1, inferred: 1 },
      reviews: 2,
      durationFacts: 3,
    }
    // Every one of these is cached with staleTime Infinity, so only an explicit
    // invalidation can make the reader see the notes the mount just moved in.
    const stale = {
      'annotations': ['annotations', 'bv-target'],
    } as const
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(stale.annotations, { data: [] })
    client.setQueryData(['reader-ideas', 'bv-target'], { data: [] })
    client.setQueryData(['progress', 'bv-target', 'user'], { data: null })

    vi.mocked(apiGet).mockResolvedValue({ data: books as unknown as BookListItem[] })
    vi.mocked(apiPost).mockImplementation((async (url: string) => (
      String(url).includes('/mount') ? { data: mountResult } : { data: report }
    )) as never)

    const onMounted = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <ImportLocatorDialog archiveId="arc-1" archiveTitle="机器人大战" onClose={() => {}} onMounted={onMounted} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByText('机器人大战'))
    fireEvent.click(await screen.findByText('readingImport.mountConfirm'))
    await waitFor(() => expect(onMounted).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(client.getQueryState(stale.annotations)?.isInvalidated).toBe(true))
    expect(client.getQueryState(['reader-ideas', 'bv-target'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['progress', 'bv-target', 'user'])?.isInvalidated).toBe(true)
  })
  it('pre-fills search box with archiveTitle and syncs dynamically', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: books as unknown as BookListItem[] })
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImportLocatorDialog archiveId="arc-1" archiveTitle="" onClose={() => {}} />
      </QueryClientProvider>,
    )
    const searchInput = screen.getByRole('searchbox') as HTMLInputElement
    expect(searchInput.value).toBe('')

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImportLocatorDialog archiveId="arc-1" archiveTitle="高达大战" onClose={() => {}} />
      </QueryClientProvider>,
    )
    expect(searchInput.value).toBe('高达大战')
  })
})