import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWereadWebBookList, fetchWereadWebProposal } from './weread-web-import'

const { fetchApi, fetchReadInfo } = vi.hoisted(() => ({ fetchApi: vi.fn(), fetchReadInfo: vi.fn() }))

vi.mock('./weread-web', () => ({
  fetchWereadWebApi: fetchApi,
  fetchBookReadInfo: fetchReadInfo,
}))

const credential = { vid: '306734116', skey: 'cookie-secret' }

beforeEach(() => {
  fetchApi.mockReset()
  fetchReadInfo.mockReset()
  fetchApi.mockImplementation(async (_credential: unknown, params: Record<string, unknown>) => {
    switch (params.api_name) {
      case '/user/notebooks':
        return { books: [{ bookInfo: { bookId: 'notebook-1', title: '有笔记的书', author: '作者' }, noteCount: 1, reviewCount: 1 }] }
      case '/shelf/sync':
        return { books: [{ bookId: 'no-notes-1', title: '只有时长的书', author: '作者', finishReading: 0 }], albums: [] }
      case '/book/bookmarklist':
        return { chapters: [{ chapterUid: 3, title: '第一章' }], updated: [{ bookmarkId: 'highlight-1', markText: '划线原文', chapterUid: 3, createTime: 100, colorStyle: 2 }] }
      case '/review/list/mine':
        return { reviews: [{ review: { reviewId: 'idea-1', content: '我的想法', abstract: '引用', chapterUid: 3, createTime: 101 } }], hasMore: 0 }
      case '/book/getprogress':
        return { book: { progress: 100 } }
      default:
        throw new Error(`unexpected WeRead endpoint: ${String(params.api_name)}`)
    }
  })
  fetchReadInfo.mockResolvedValue({
    days: [{ date: '2026-10-31', seconds: 3222 }],
    totalSeconds: 3222,
    progress: 100,
    finished: true,
    finishedDate: null,
    droppedDays: 0,
  })
})

describe('WeRead Web import channel', () => {
  it('builds the Web book list from the Cookie endpoints and includes the whole shelf', async () => {
    const list = await fetchWereadWebBookList(credential, 'all')

    expect(fetchApi.mock.calls.map(([, params]) => (params as Record<string, unknown>).api_name)).toEqual([
      '/user/notebooks', '/shelf/sync',
    ])
    expect(list.books.map((book) => book.sourceBookId)).toEqual(['notebook-1', 'no-notes-1'])
    expect(list.listCounts?.['notebook-1']).toEqual({ notes: 2, reviews: 0 })
  })

  it('adds shelf reading times to notes-only books without adding other shelf entries', async () => {
    fetchApi.mockImplementation(async (_credential: unknown, params: Record<string, unknown>) => {
      if (params.api_name === '/user/notebooks') return { books: [{ bookInfo: { bookId: 'a', title: 'A' }, noteCount: 1, sort: 123 }] }
      if (params.api_name === '/shelf/sync') return { books: [{ bookId: 'a', title: 'A', readUpdateTime: 456 }, { bookId: 'b', title: 'B' }] }
      throw new Error('unexpected endpoint')
    })
    const list = await fetchWereadWebBookList(credential, 'notes')
    expect(list.books).toHaveLength(1)
    expect(list.books[0]).toMatchObject({ lastReadAt: 456000, lastNoteAt: 123000 })
  })

  it('fetches notes and daily time through the same Web channel', async () => {
    const proposal = await fetchWereadWebProposal(credential, 'all', ['notebook-1'])

    expect(proposal.notes.map((note) => [note.kind, note.text, note.note])).toEqual([
      ['highlight', '划线原文', null],
      ['idea', '引用', '我的想法'],
    ])
    expect(proposal.durationFacts).toEqual([{
      sourceBookId: 'notebook-1',
      sourceRecordKey: 'web-day:notebook-1:2026-10-31',
      granularity: 'book_day',
      date: '2026-10-31',
      seconds: 3222,
      aggregationRole: 'additive',
    }])
  })

  it('imports selected time-only shelf books without requiring a prior binding', async () => {
    const proposal = await fetchWereadWebProposal(credential, 'time', ['no-notes-1'])

    expect(proposal.books.map((book) => book.sourceBookId)).toEqual(['no-notes-1'])
    expect(proposal.notes).toEqual([])
    expect(proposal.durationFacts[0]).toMatchObject({
      sourceBookId: 'no-notes-1',
      granularity: 'book_day',
      date: '2026-10-31',
      seconds: 3222,
    })
    expect(fetchReadInfo).toHaveBeenCalledWith(credential, 'no-notes-1', undefined)
  })
})
