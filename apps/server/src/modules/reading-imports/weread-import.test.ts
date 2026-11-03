import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { applyImport } from './reading-imports.service'
import { fetchWereadBookList, fetchWereadProposal } from './weread-import'

const gateway = vi.fn()
vi.mock('../integrations/weread.service', () => ({
  wereadGateway: (...args: unknown[]) => gateway(...args),
}))

type TestDb = ReturnType<typeof drizzle<typeof schema>>

function respond(payload: Record<string, unknown>): Record<string, unknown> {
  switch (payload.api_name) {
    case '/shelf/sync':
      return { books: [{ bookId: 'b1', title: '三体', author: '刘慈欣', format: 'epub' }] }
    case '/user/notebooks':
      return { books: [{ book: { bookId: 'b1', title: '三体', author: '刘慈欣' } }], hasMore: 0 }
    case '/book/bookmarklist':
      return {
        chapters: [{ chapterUid: 1, title: '第一章' }],
        updated: [
          { bookmarkId: 'bm-1', markText: '黑暗森林', chapterUid: 1, createTime: 1700000000, colorStyle: 3, range: '3627-3641' },
          { bookmarkId: 'bm-2', markText: '面壁者', chapterUid: 1, createTime: 1700000100, colorStyle: 0, range: '100-120' },
        ],
      }
    case '/review/list/mine':
      return {
        reviews: [
          { review: { reviewId: 'rv-1', content: '这里写得真好', abstract: '黑暗森林', range: '3627-3641', chapterUid: 1, chapterName: '第一章', createTime: 1700000200 } },
          { review: { reviewId: 'rv-2', content: '整本书评', createTime: 1700000300, star: 100, newRatingLevel: 1 } },
          { review: { reviewId: 'rv-3', content: '值得一读', createTime: 1700000400, star: 60, newRatingLevel: 2 } },
          { review: { reviewId: 'rv-4', content: '不行', createTime: 1700000500, star: 20, newRatingLevel: 3 } },
          { review: { reviewId: 'rv-5', content: '半星档', createTime: 1700000600, star: 90, newRatingLevel: 1 } },
          { review: { reviewId: 'rv-6', content: '只有等级', createTime: 1700000700, newRatingLevel: 2 } },
          { review: { reviewId: 'rv-7', content: '没打分', createTime: 1700000800, star: -1, newRatingLevel: -1 } },
          { review: { reviewId: 'rv-8', content: '零分', createTime: 1700000900, star: 0 } },
          { review: { reviewId: 'rv-9', content: '非十的倍数', createTime: 1700001000, star: 15 } },
          { review: { reviewId: 'rv-10', content: '未知等级', createTime: 1700001100, newRatingLevel: 4 } },
          { review: { reviewId: 'rv-11', content: '无字段', createTime: 1700001200 } },
        ],
        hasMore: 0,
      }
    case '/book/getprogress':
      return { book: { readingTime: 999999999999, progress: 100 } }
    default:
      throw new Error(`unexpected api_name ${String(payload.api_name)}`)
  }
}

describe('weread import fidelity', () => {
  let db: TestDb
  let userId: string

  beforeEach(async () => {
    gateway.mockReset()
    gateway.mockImplementation(async (_key: string, payload: Record<string, unknown>) => respond(payload))
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: 'reader', createdAt: Date.now() }).run()
  })

  it('keeps source colors and locators and produces no duration facts', async () => {
    const proposal = await fetchWereadProposal('wrk-test', 'all')

    expect(proposal.notes.map((note) => [note.sourceRecordId, note.kind, note.color, note.locator, note.chapterIndex])).toEqual([
      ['bm-1', 'highlight', 'blue', '3627', 1],
      // colorStyle 0 carries no mapped meaning: the kind default applies at write time.
      ['bm-2', 'highlight', null, '100', 1],
      ['rv-1', 'idea', null, '3627', 1],
    ])

    // Live-verified payload scale (2026-11-04, both channels): type=4 reviews
    // carry `star` on a 0-100 legacy scale (10 = half a star) plus
    // `newRatingLevel` (1=推荐, 2=一般, 3=不行). Star wins; level is the
    // fallback; unrated markers and unknown values stay null.
    expect(proposal.reviews.map((review) => [review.sourceRecordId, review.rating])).toEqual([
      ['rv-2', 5],
      ['rv-3', 3],
      ['rv-4', 1],
      ['rv-5', 4.5],
      ['rv-6', 3],
      ['rv-7', null],
      ['rv-8', null],
      ['rv-9', null],
      ['rv-10', null],
      ['rv-11', null],
    ])

    // This channel has no duration at all: neither the account buckets nor the
    // single-book cumulative total may be turned into facts.
    expect(proposal.durationFacts).toEqual([])
    expect(proposal.unprocessable).toEqual([])
    expect(proposal.books[0]).toMatchObject({ finished: true, meta: { format: 'epub', finished: true } })

    await applyImport(userId, 'weread', 'key:test', proposal, 'all')

    const highlights = db.select().from(schema.highlights).where(eq(schema.highlights.userId, userId)).all()
    expect(highlights.map((row) => [row.text, row.color, row.style, row.importLocator, row.importChapterIndex])).toEqual([
      ['黑暗森林', 'blue', 'underline', '3627', 1],
      ['面壁者', 'yellow', 'underline', '100', 1],
    ])
    const ideas = db.select().from(schema.ideas).where(eq(schema.ideas.userId, userId)).all()
    expect(ideas).toMatchObject([{ text: '黑暗森林', note: '这里写得真好', color: 'amber', style: 'underline', importLocator: '3627', importChapterIndex: 1 }])

    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, userId)).all()).toEqual([])
  })

  it('reports a time-only request as unsupported instead of inventing durations', async () => {
    const before = gateway.mock.calls.length
    const proposal = await fetchWereadProposal('wrk-test', 'time')
    expect(proposal.books).toEqual([])
    expect(proposal.durationFacts).toEqual([])
    expect(proposal.unprocessable).toEqual([{ reason: 'time-requires-web', count: 1 }])
    // Nothing is fetched: no endpoint on this channel carries that granularity.
    expect(gateway.mock.calls.length).toBe(before)
  })

  it('re-imports a color change instead of treating the note as unchanged', async () => {
    const first = await fetchWereadProposal('wrk-test', 'all')
    await applyImport(userId, 'weread', 'key:test', first, 'all')

    const recolored = {
      ...first,
      notes: first.notes.map((note) => (note.sourceRecordId === 'bm-1' ? { ...note, color: 'red' } : note)),
    }
    const result = await applyImport(userId, 'weread', 'key:test', recolored, 'all')
    expect(result.notes).toEqual({ new: 0, updated: 1, unchanged: 2 })

    const highlight = db.select().from(schema.highlights)
      .where(eq(schema.highlights.userId, userId)).all()
      .find((row) => row.text === '黑暗森林')!
    expect(highlight.color).toBe('red')
  })

  it('follows boolean notebook pagination and includes unfinished shelf books', async () => {
    let notebookPage = 0
    gateway.mockImplementation(async (_key: string, payload: Record<string, unknown>) => {
      switch (payload.api_name) {
        case '/user/notebooks':
          notebookPage++
          if (notebookPage === 2) {
            expect(payload.lastSort).toBe(1)
            return { books: [{ book: { bookId: 'b101', title: '第一百零一本' }, noteCount: 1, reviewCount: 0, sort: 0 }], hasMore: false }
          }
          return {
            books: Array.from({ length: 100 }, (_, index) => ({
              book: { bookId: `book-${index + 1}`, title: `第${index + 1}本` },
              noteCount: index === 0 ? 2 : 0,
              reviewCount: index === 0 ? 1 : 0,
              sort: 100 - index,
            })),
            hasMore: true,
          }
        case '/shelf/sync':
          return { books: [
            { bookId: 'shelf-1', title: '读完了', finishReading: 1 },
            { bookId: 'shelf-2', title: '还在读', finishReading: 0 },
          ] }
        default:
          throw new Error(`nobody should fetch records while listing: ${String(payload.api_name)}`)
      }
    })

    const list = await fetchWereadBookList('wrk-test', 'all')

    expect(gateway).toHaveBeenCalledTimes(3)
    expect(list.books).toHaveLength(103)
    expect(list.books.map((book) => book.sourceBookId)).toContain('b101')
    expect(list.books.map((book) => book.sourceBookId)).toContain('shelf-2')
    // noteCount counts highlights, reviewCount counts ideas: 2 + 1 = 3 records.
    expect(list.listCounts).toMatchObject({
      'book-1': { notes: 3, reviews: 0 },
      'book-2': { notes: 0, reviews: 0 },
      b101: { notes: 1, reviews: 0 },
      'shelf-1': { notes: 0, reviews: 0 },
      'shelf-2': { notes: 0, reviews: 0 },
    })
    expect(list.notes).toEqual([])
  })

  it('fetches details only for the ticked books', async () => {
    gateway.mockImplementation(async (_key: string, payload: Record<string, unknown>) => {
      switch (payload.api_name) {
        case '/user/notebooks':
          return {
            books: [
              { book: { bookId: 'b1', title: '三体' }, noteCount: 2, reviewCount: 1 },
              { book: { bookId: 'b2', title: '球状闪电' }, noteCount: 5, reviewCount: 0 },
            ],
            hasMore: 0,
          }
        case '/book/bookmarklist':
          return { chapters: [], updated: [{ bookmarkId: `bm-${String(payload.bookId)}`, markText: '一句' }] }
        case '/review/list/mine':
          return { reviews: [], hasMore: 0 }
        case '/book/getprogress':
          return { book: { progress: 100 } }
        case '/shelf/sync':
          return { books: [{ bookId: 'b1', title: '三体' }], albums: [] }
        default:
          throw new Error(`unexpected api_name ${String(payload.api_name)}`)
      }
    })

    const proposal = await fetchWereadProposal('wrk-test', 'all', ['b2'])

    expect(proposal.books.map((book) => book.sourceBookId)).toEqual(['b2'])
    expect(proposal.notes.map((note) => note.sourceBookId)).toEqual(['b2'])
    const fetched = gateway.mock.calls.map(([, payload]) => payload as Record<string, unknown>)
    expect(fetched.some((payload) => payload.api_name === '/shelf/sync')).toBe(true)
    expect(fetched.filter((payload) => payload.api_name === '/book/bookmarklist').map((payload) => payload.bookId))
      .toEqual(['b2'])
  })
})
