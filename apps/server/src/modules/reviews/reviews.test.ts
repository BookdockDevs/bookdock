import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import { deleteBook, restoreBook, trashBook } from '../books/books.service'
import { deleteCatalogBook, deleteCatalogVersion, permanentDeleteCatalogBook, restoreCatalogBook } from '../libraries/catalog.service'
import { forkLocalBook } from '../libraries/fork.service'
import { deleteLibrary } from '../libraries/libraries.service'
import { getReviewBookContext, getReviewWorkContext, createReview, deleteReview, myReviews, readerProfile, updateReview } from './reviews.service'
import { noteArchive } from '../annotations/note-archive.service'
import annotationRoutes from '../annotations/annotations.routes'
import reviewRoutes from './reviews.routes'
import { errorHandler } from '../../middleware/error'
import { reviewComposerContext } from './review-access'
import {
  createReviewComment,
  deleteReviewComment,
  getReviewDiscussion,
  setReviewLike,
  updateReviewComment,
} from './review-discussion.service'

describe('book reviews', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>
  const now = 1000

  function seed() {
    for (const id of ['owner', 'admin', 'member', 'outsider', 'author', 'critic']) {
      db.insert(schema.users).values({ id, username: id, createdAt: now }).run()
    }
    db.insert(schema.libraries).values({ id: 'source', userId: 'owner', type: 'shared', name: 'Source', visibility: 'public', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraries).values({ id: 'other', userId: 'owner', type: 'shared', name: 'Other', visibility: 'public', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraries).values({ id: 'privAuthor', userId: 'author', type: 'private', name: '', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraries).values({ id: 'privMember', userId: 'member', type: 'private', name: '', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraries).values({ id: 'privCritic', userId: 'critic', type: 'private', name: '', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryMemberships).values({ id: 'm-admin', libraryId: 'source', userId: 'admin', role: 'admin', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryMemberships).values({ id: 'm-member', libraryId: 'source', userId: 'member', role: 'member', createdAt: now, updatedAt: now }).run()
    // Source work w1 with two versions; w2 is a second work; other-library work reuses v1 bytes.
    db.insert(schema.libraryBooks).values({ id: 'w1', libraryId: 'source', userId: 'owner', title: 'Work One', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryBooks).values({ id: 'w2', libraryId: 'source', userId: 'owner', title: 'Work Two', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryBooks).values({ id: 'w3', libraryId: 'other', userId: 'owner', title: 'Elsewhere', createdAt: now, updatedAt: now }).run()
    for (const id of ['v1', 'v2', 'v3', 'va']) {
      db.insert(schema.bookVersions).values({ id, format: 'epub', size: 1, createdAt: now, updatedAt: now }).run()
      db.insert(schema.contentRevisions).values({ id: `r-${id}`, bookVersionId: id, revisionNo: 1, blobKey: `k-${id}`, size: 1, createdAt: now }).run()
    }
    const listing = (id: string, libraryId: string, workId: string, versionId: string, name: string) =>
      db.insert(schema.libraryBookVersions).values({ id, libraryId, libraryBookId: workId, bookVersionId: versionId, kind: 'personal', name, createdAt: now, updatedAt: now }).run()
    listing('l1', 'source', 'w1', 'v1', 'First edition')
    listing('l2', 'source', 'w1', 'v2', 'Second edition')
    listing('l3', 'source', 'w2', 'v3', '')
    listing('l4', 'other', 'w3', 'v1', '')
    // Author collects both versions of w1 plus w2; member collects v1; author owns a pure private A.
    const collect = (id: string, libraryId: string, workId: string, versionId: string, sourceId: string, userId: string) => {
      db.insert(schema.libraryBooks).values({ id: workId, libraryId, userId, title: `Card ${id}`, createdAt: now, updatedAt: now }).run()
      db.insert(schema.libraryBookVersions).values({ id, libraryId, libraryBookId: workId, bookVersionId: versionId, kind: 'shared', sourceLibraryId: 'source', sourceLibraryBookVersionId: sourceId, pinnedRevisionId: `r-${versionId}`, createdAt: now, updatedAt: now }).run()
    }
    collect('b1', 'privAuthor', 'bw1', 'v1', 'l1', 'author')
    collect('b2', 'privAuthor', 'bw2', 'v2', 'l2', 'author')
    collect('b3', 'privAuthor', 'bw3', 'v3', 'l3', 'author')
    collect('mb1', 'privMember', 'mw1', 'v1', 'l1', 'member')
    collect('cb1', 'privCritic', 'cw1', 'v2', 'l2', 'critic')
    db.insert(schema.libraryBooks).values({ id: 'aw', libraryId: 'privAuthor', userId: 'author', title: 'Mine', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryBookVersions).values({ id: 'la', libraryId: 'privAuthor', libraryBookId: 'aw', bookVersionId: 'va', kind: 'personal', createdAt: now, updatedAt: now }).run()
  }

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const files = new Map<string, Buffer>()
    const driver: StorageDriver = {
      async put(key, data) {
        if (Buffer.isBuffer(data)) files.set(key, data)
        else {
          const chunks: Buffer[] = []
          for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          files.set(key, Buffer.concat(chunks))
        }
      },
      async get(key) {
        const buf = files.get(key)
        if (!buf) throw new Error(`missing blob: ${key}`)
        return Readable.from(buf)
      },
      async delete(key) { files.delete(key) },
      async exists(key) { return files.has(key) },
      async size(key) { return files.get(key)?.length ?? 0 },
    }
    vi.spyOn(storage, 'getStorage').mockReturnValue(driver)
    seed()
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  it('rejects anonymous private archives and malformed pagination at the HTTP boundary', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      const id = c.req.header('x-test-user')
      c.set('user', id ? { id, username: id, role: 'member', avatarKey: null } : null)
      await next()
    })
    app.route('/api/v1/annotations', annotationRoutes)
    app.route('/api/v1/reviews', reviewRoutes)
    expect((await app.request('/api/v1/annotations/mine')).status).toBe(401)
    expect((await app.request('/api/v1/reviews/mine')).status).toBe(401)
    expect((await app.request('/api/v1/annotations/mine?pageSize=999', { headers: { 'x-test-user': 'author' } })).status).toBe(400)
    expect((await app.request('/api/v1/reviews/author/author?page=-1', { headers: { 'x-test-user': 'member' } })).status).toBe(400)
    db.insert(schema.ideas).values({ id: 'only-author', userId: 'author', bookVersionId: 'v1', cfiRange: 'txt:0', note: 'Private body', createdAt: now, updatedAt: now }).run()
    const response = await app.request('/api/v1/annotations/mine?userId=author', { headers: { 'x-test-user': 'admin' } })
    expect(await response.json()).toMatchObject({ data: { entries: [] } })
  })

  it('projects other profiles only through current shared work permissions', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'Visible', visibility: 'shared' })
    expect((await readerProfile('member', 'author', { page: 1, pageSize: 20 })).reviews.entries.map((entry) => entry.review.id)).toEqual([review.id])
    await updateReview('author', review.id, { visibility: 'private' })
    for (const viewer of ['owner', 'admin', 'member', 'outsider', null]) {
      expect((await readerProfile(viewer, 'author', { page: 1, pageSize: 20 })).reviews.entries).toEqual([])
    }
    expect((await readerProfile('author', 'author', { page: 1, pageSize: 20 })).reviews.entries).toHaveLength(1)
    await updateReview('author', review.id, { visibility: 'shared' })
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    expect((await readerProfile('outsider', 'author', { page: 1, pageSize: 20 })).reviews).toEqual({ entries: [], page: 1, hasMore: false })
    expect((await readerProfile('admin', 'author', { page: 1, pageSize: 20 })).reviews.entries).toHaveLength(1)
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, 'source')).run()
    expect((await readerProfile('outsider', 'author', { page: 1, pageSize: 20 })).reviews.entries).toHaveLength(1)
  })

  it('bounds owner review archives and preserves stable newest-first pages', async () => {
    for (let i = 0; i < 25; i++) {
      db.insert(schema.libraryBooks).values({ id: `archive-work-${i}`, libraryId: 'privAuthor', userId: 'author', title: 'Private', createdAt: i, updatedAt: i }).run()
      db.insert(schema.bookReviews).values({ id: `archive-review-${i}`, userId: 'author', privateLibraryBookId: `archive-work-${i}`, body: 'Private', createdAt: i, updatedAt: i }).run()
    }
    const first = await myReviews('author', { page: 1, pageSize: 20 })
    const second = await myReviews('author', { page: 2, pageSize: 20 })
    expect(first.entries).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(second.entries).toHaveLength(5)
    expect(second.hasMore).toBe(false)
    expect(first.entries[0].review.id).toBe('archive-review-24')
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.review.id)).size).toBe(25)
    expect((await readerProfile('admin', 'author', { page: 1, pageSize: 20 })).reviews.entries).toEqual([])
  })

  it('keeps global notes author-only with book filtering, pagination and honest location states', async () => {
    for (let i = 0; i < 25; i++) {
      db.insert(schema.highlights).values({ id: `archive-note-${i}`, userId: 'author', bookVersionId: 'v1', revisionId: 'r-v1', cfiRange: `epubcfi(/6/${i * 2 + 2})`, text: 'Private quote', createdAt: i, updatedAt: i }).run()
    }
    const first = await noteArchive('author', { page: 1, pageSize: 20, bookId: 'v1' })
    expect(first.entries).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(first.entries.every((entry) => entry.locationStatus === 'available')).toBe(true)
    expect((await noteArchive('author', { page: 2, pageSize: 20 })).entries).toHaveLength(5)
    for (const viewer of ['owner', 'admin', 'member', 'outsider']) {
      expect((await noteArchive(viewer, { page: 1, pageSize: 20 })).entries).toEqual([])
    }
    expect((await noteArchive('author', { page: 1, pageSize: 20, bookId: 'v2' })).entries).toEqual([])
    db.update(schema.highlights).set({ revisionId: 'missing-revision' }).run()
    expect((await noteArchive('author', { page: 1, pageSize: 20 })).entries.every((entry) => entry.locationStatus === 'position-unavailable')).toBe(true)
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    const lost = await noteArchive('author', { page: 1, pageSize: 20 })
    expect(lost.entries.every((entry) => entry.locationStatus === 'source-unavailable' && entry.bookTitle === null)).toBe(true)
    expect(lost.entries[0].annotation.text).toBe('Private quote')
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, 'source')).run()
    db.update(schema.highlights).set({ revisionId: 'r-v1' }).run()
    expect((await noteArchive('author', { page: 1, pageSize: 20 })).entries.every((entry) => entry.locationStatus === 'available')).toBe(true)
  })

  it('stores half-star steps exactly and requires rating or body', async () => {
    const both = await createReview('author', { bookVersionId: 'v1', rating: 4.5, body: 'Great **book**', visibility: 'shared' })
    expect(both).toMatchObject({ rating: 4.5, body: 'Great **book**', bodyFormat: 'markdown', visibility: 'shared' })
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, both.id)).get()).toMatchObject({ ratingHalves: 9 })
    await expect(createReview('author', { bookVersionId: 'v3', rating: 2.5, visibility: 'private' })).resolves.toMatchObject({ rating: 2.5, body: null })
    await expect(createReview('member', { bookVersionId: 'v1', body: 'text only', visibility: 'private' })).resolves.toMatchObject({ rating: null, body: 'text only' })
    // Unheld reads cannot publish at all: collecting comes first.
    await expect(createReview('critic', { bookVersionId: 'v1', body: 'no card' })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await expect(createReview('member', { bookVersionId: 'v1', body: '   ', rating: null })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    // Ten buckets survive without float loss: 0.5 lands in its own bucket, not rounded to 1.
    await createReview('critic', { bookVersionId: 'v2', rating: 0.5, visibility: 'shared' })
    const ctx = await getReviewWorkContext('outsider', 'source', 'w1')
    expect(ctx.summary?.distribution).toHaveLength(10)
    expect(ctx.summary?.distribution.map((bucket) => bucket.rating)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
    expect(ctx.summary).toMatchObject({ average: 2.5, count: 2 })
  })

  it('keeps pure private reviews author-only and cascades with their work', async () => {
    const review = await createReview('author', { bookVersionId: 'va', rating: 5, body: 'mine' })
    expect(review).toMatchObject({ visibility: 'private', privateLibraryBookId: 'aw', source: null, provenance: null })
    await expect(createReview('author', { bookVersionId: 'va', rating: 4 })).rejects.toMatchObject({
      code: 'REVIEW_ALREADY_EXISTS',
    })
    // A private anchor can never be published, including through edits.
    await expect(updateReview('author', review.id, { visibility: 'shared' })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    const ctx = await getReviewBookContext('author', 'va')
    expect(ctx).toMatchObject({ summary: null, reviews: [] })
    expect(ctx.own?.id).toBe(review.id)
    await expect(getReviewDiscussion('member', review.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await expect(getReviewDiscussion('owner', review.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    expect((await myReviews('author')).entries).toHaveLength(1)
    await deleteBook('author', 'va')
    expect((await myReviews('author')).entries).toHaveLength(0)
  })

  it('shares one review across two collected versions of one source work, counted once', async () => {
    const first = await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'same work', visibility: 'shared' })
    await expect(createReview('author', { bookVersionId: 'v2', rating: 5 })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' })
    const viaSecond = await getReviewBookContext('author', 'v2')
    expect(viaSecond.own?.id).toBe(first.id)
    expect(viaSecond.summary).toMatchObject({ average: 4, count: 1 })
    expect(viaSecond.reviews.map((row) => row.id)).toEqual([first.id])
    await updateReview('author', first.id, { rating: 3 })
    expect((await getReviewBookContext('author', 'v1')).own?.rating).toBe(3)
    expect((await getReviewBookContext('author', 'v2')).summary).toMatchObject({ average: 3, count: 1 })
    // Provenance records the read version but never decides the home.
    expect(first.provenance).toMatchObject({ listingId: 'l1', bookVersionId: 'v1', available: true, versionName: 'First edition' })
  })

  it('never merges works across libraries even for identical content', async () => {
    await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })
    const elsewhere = await getReviewWorkContext('outsider', 'other', 'w3')
    expect(elsewhere).toMatchObject({ summary: { average: null, count: 0 }, reviews: [] })
    const second = await getReviewWorkContext('outsider', 'source', 'w2')
    expect(second.reviews).toHaveLength(0)
  })

  it('excludes private ratings from shared statistics while listing text-only bodies', async () => {
    await createReview('author', { bookVersionId: 'v1', rating: 5, visibility: 'shared' })
    await createReview('member', { bookVersionId: 'v1', rating: 1, visibility: 'private' })
    await createReview('critic', { bookVersionId: 'v1', body: 'no stars from me', visibility: 'shared' }).catch(async (error) => {
      // critic holds no card: collect-free reads cannot publish.
      expect(error.code).toBe('REVIEW_NOT_FOUND')
      return null
    })
    const ctx = await getReviewWorkContext('member', 'source', 'w1')
    expect(ctx.summary).toMatchObject({ average: 5, count: 1 })
    expect(ctx.reviews.map((row) => row.author.name)).toEqual(['author'])
    // The member's own private review stays visible to them only.
    expect(ctx.own?.visibility).toBe('private')
    await expect(getReviewDiscussion('author', ctx.own!.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await expect(getReviewDiscussion('admin', ctx.own!.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    expect((await getReviewDiscussion('member', ctx.own!.id)).review.visibility).toBe('private')
  })

  it('remembers an independent new-review default and never moves it on cancel, failure or edit', async () => {
    expect(await reviewComposerContext('author', 'v1')).toMatchObject({ anchor: 'source', eligible: true, defaultVisibility: 'shared' })
    const created = await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'private' })
    expect(await reviewComposerContext('author', 'v3')).toMatchObject({ defaultVisibility: 'private' })
    await expect(createReview('author', { bookVersionId: 'v1', rating: 5 })).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' })
    expect(await reviewComposerContext('author', 'v3')).toMatchObject({ defaultVisibility: 'private' })
    await updateReview('author', created.id, { visibility: 'shared' })
    expect(await reviewComposerContext('author', 'v3')).toMatchObject({ defaultVisibility: 'private' })
    const shared = await createReview('author', { bookVersionId: 'v3', body: 'now shared', visibility: 'shared' })
    expect(shared.visibility).toBe('shared')
    expect(await reviewComposerContext('author', 'v1')).toMatchObject({ defaultVisibility: 'shared' })
  })

  it('requires the collector own listing to publish shared, while work reads stay work-level', async () => {
    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    // member holds v1 through the now-unlisted l1: the work still reads via
    // l2, but a shared publish from the dead listing is refused.
    expect(await reviewComposerContext('member', 'v1')).toMatchObject({
      anchor: 'source',
      eligible: true,
      sourceReadable: true,
      canPublishShared: false,
      defaultVisibility: 'private',
    })
    await expect(createReview('member', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
    })
    expect((await getReviewWorkContext('member', 'source', 'w1')).summary).toMatchObject({ count: 0 })
    // A private review on the same holding is still allowed.
    const priv = await createReview('member', { bookVersionId: 'v1', rating: 4, visibility: 'private' })
    // Turning it shared is refused while the own listing is dead...
    await expect(updateReview('member', priv.id, { visibility: 'shared' })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
    })
    // ...and allowed once the listing reads again.
    db.update(schema.libraryBookVersions).set({ status: 'published' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    expect(await reviewComposerContext('member', 'v1')).toMatchObject({ canPublishShared: true })
    await updateReview('member', priv.id, { visibility: 'shared' })
    expect((await getReviewWorkContext('outsider', 'source', 'w1')).summary).toMatchObject({ count: 1 })
  })

  it('hides live source metadata without current permission while retaining the author copy', async () => {
    const review = await createReview('author', { bookVersionId: 'v2', rating: 4, body: 'kept', visibility: 'shared' })
    db.update(schema.libraryBooks).set({ hidden: true }).where(eq(schema.libraryBooks.id, 'w1')).run()
    const mine = await myReviews('author')
    expect(mine.entries[0]).toMatchObject({ sourceStatus: 'unavailable', workTitle: null })
    const ctx = await getReviewBookContext('author', 'v2')
    expect(ctx.own?.source?.libraryName).toBeNull()
    expect(ctx.own).toMatchObject({ rating: 4, body: 'kept' })
    expect((await getReviewDiscussion('author', review.id)).review.body).toBe('kept')
    db.update(schema.libraryBooks).set({ hidden: false }).where(eq(schema.libraryBooks.id, 'w1')).run()
    expect((await myReviews('author')).entries[0].workTitle).toBe('Work One')
    expect((await getReviewBookContext('author', 'v2')).own?.source?.libraryName).toBe('Source')
  })

  it('retains shared visibility across body-only edits while the source is down', async () => {
    const review = await createReview('author', { bookVersionId: 'v2', rating: 4, body: 'before', visibility: 'shared' })
    await deleteCatalogBook('owner', 'source', 'w1')
    const updated = await updateReview('author', review.id, { body: 'edited while stranded' })
    expect(updated).toMatchObject({ body: 'edited while stranded', visibility: 'shared' })
    expect((await myReviews('author')).entries[0].review.visibility).toBe('shared')
    // An explicit private switch still applies; re-sharing waits for recovery.
    await updateReview('author', review.id, { visibility: 'private' })
    await expect(updateReview('author', review.id, { visibility: 'shared' })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
    })
    await restoreCatalogBook('owner', 'source', 'w1')
    await updateReview('author', review.id, { visibility: 'shared' })
    expect((await getReviewWorkContext('member', 'source', 'w1')).summary).toMatchObject({ count: 1 })
  })

  it('keeps source-manager discussion deletes for authors who manage the source', async () => {
    db.insert(schema.libraryMemberships)
      .values({ id: 'm-author', libraryId: 'source', userId: 'author', role: 'admin', createdAt: now, updatedAt: now })
      .run()
    const review = await createReview('author', { bookVersionId: 'v2', rating: 4, visibility: 'shared' })
    const comment = await createReviewComment('member', review.id, { body: 'needs removal' })
    expect((await getReviewDiscussion('author', review.id)).comments[0]).toMatchObject({ canDelete: true })
    await deleteReviewComment('author', review.id, comment)
    expect((await getReviewDiscussion('member', review.id)).comments).toHaveLength(0)
    // Authorship alone still grants no management over others' threads.
    const other = await createReview('critic', { bookVersionId: 'v2', body: 'other work review', visibility: 'shared' })
    const otherComment = await createReviewComment('member', other.id, { body: 'stays' })
    await expect(deleteReviewComment('critic', other.id, otherComment)).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
    })
    expect((await getReviewDiscussion('member', other.id)).comments).toHaveLength(1)
  })

  it('refuses re-sharing from trashed holdings while keeping shared reads', async () => {
    const priv = await createReview('member', { bookVersionId: 'v1', rating: 4, visibility: 'private' })
    await trashBook('member', 'v1')
    // The only holding sits in the private trash: re-sharing is refused even
    // though the source work still reads for everyone else.
    await expect(updateReview('member', priv.id, { visibility: 'shared' })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
    })
    const ctx = await getReviewWorkContext('member', 'source', 'w1')
    expect(ctx.summary).toMatchObject({ count: 0 })
    expect(ctx.composer.eligible).toBe(false)
    // Restoring the holding restores eligibility.
    await restoreBook('member', 'v1')
    await updateReview('member', priv.id, { visibility: 'shared' })
    expect((await getReviewWorkContext('outsider', 'source', 'w1')).summary).toMatchObject({ count: 1 })
  })

  it('gates shared reads and interactions on current source access without leaking hidden versions', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'hello', visibility: 'shared' })
    await createReviewComment('outsider', review.id, { body: 'agreed' })
    await setReviewLike('member', review.id, true)
    // Members and readable non-members interact; the author keeps working after membership changes.
    expect((await getReviewDiscussion('outsider', review.id)).comments).toHaveLength(1)
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    await expect(getReviewDiscussion('outsider', review.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await expect(createReviewComment('outsider', review.id, { body: 'denied' })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    expect((await getReviewDiscussion('member', review.id)).review.likeCount).toBe(1)
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, 'source')).run()
    // Hiding the work closes shared access but keeps the author's own review and choice.
    db.update(schema.libraryBooks).set({ hidden: true }).where(eq(schema.libraryBooks.id, 'w1')).run()
    await expect(getReviewWorkContext('member', 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await expect(getReviewWorkContext('admin', 'source', 'w1')).resolves.toMatchObject({ summary: { count: 1 } })
    const hidden = await getReviewDiscussion('admin', review.id)
    expect(hidden.review.provenance).toMatchObject({ available: true })
    const own = await getReviewBookContext('author', 'v2')
    expect(own.own?.visibility).toBe('shared')
    expect(own.summary).toBeNull()
    db.update(schema.libraryBooks).set({ hidden: false }).where(eq(schema.libraryBooks.id, 'w1')).run()
    // An unlisted read version degrades provenance without leaking its name.
    // Managers bypass hidden/unlisted by design; ordinary readers see the
    // unavailable state with no metadata.
    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).where(eq(schema.libraryBookVersions.id, 'l2')).run()
    expect((await getReviewDiscussion('admin', review.id)).review.provenance).toMatchObject({ available: true })
    expect((await getReviewDiscussion('author', review.id)).review.provenance).toMatchObject({ available: false, versionName: null })
    await expect(getReviewWorkContext('member', 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
  })

  it('lets guests read guest-readable works and never write', async () => {
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'owner', allowGuestAccess: true, createdAt: now, updatedAt: now }).run()
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'open', visibility: 'shared' })
    const ctx = await getReviewWorkContext(null, 'source', 'w1')
    expect(ctx.summary).toMatchObject({ count: 1 })
    expect(ctx.reviews).toHaveLength(1)
    db.update(schema.libraryBookVersions).set({ guestReadable: false }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    await expect(getReviewWorkContext(null, 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
  })

  it('keeps private discussion author-only and promotes surviving replies like ideas', async () => {
    const review = await createReview('author', { bookVersionId: 'va', body: 'private notes' })
    const parent = await createReviewComment('author', review.id, { body: 'first' })
    const reply = await createReviewComment('author', review.id, { body: 'second', replyToId: parent })
    const nested = await createReviewComment('author', review.id, { body: 'third', replyToId: reply })
    await setReviewLike('author', review.id, true)
    await setReviewLike('author', review.id, true)
    await setReviewLike('author', review.id, true, nested)
    const discussion = await getReviewDiscussion('author', review.id)
    expect(discussion.review.likeCount).toBe(1)
    expect(discussion.comments.find((comment) => comment.id === nested)).toMatchObject({
      parentId: parent,
      replyToId: reply,
      replyToName: 'author',
      likeCount: 1,
    })
    await expect(updateReviewComment('member', review.id, parent, 'hijack')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await deleteReviewComment('author', review.id, parent)
    const after = await getReviewDiscussion('author', review.id)
    expect(after.comments.find((comment) => comment.id === parent)).toBeUndefined()
    expect(after.comments.find((comment) => comment.id === reply)).toMatchObject({ parentId: null, replyToId: null, replyToName: null })
    expect(after.comments.find((comment) => comment.id === nested)).toMatchObject({ parentId: null, replyToId: reply })
  })

  it('preserves discussion across visibility toggles and lets managers delete shared content only', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })
    await createReviewComment('member', review.id, { body: 'kept' })
    await setReviewLike('member', review.id, true)
    await updateReview('author', review.id, { visibility: 'private' })
    await expect(getReviewDiscussion('member', review.id)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    expect((await getReviewDiscussion('author', review.id)).comments).toHaveLength(1)
    expect((await getReviewWorkContext('member', 'source', 'w1')).summary).toMatchObject({ count: 0 })
    await updateReview('author', review.id, { visibility: 'shared' })
    expect((await getReviewDiscussion('member', review.id)).review.likeCount).toBe(1)
    await expect(updateReview('admin', review.id, { rating: 1 })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await deleteReview('admin', review.id)
    expect((await getReviewWorkContext('member', 'source', 'w1')).summary).toMatchObject({ count: 0 })
    expect(db.select().from(schema.bookReviewComments).all()).toEqual([])
    expect(db.select().from(schema.bookReviewLikes).all()).toEqual([])
  })

  it('retains source reviews after uncollect, version delete, trash and restore', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })
    await createReviewComment('member', review.id, { body: 'survives' })
    await deleteBook('author', 'v1', { deleteUserData: true })
    expect((await myReviews('author')).entries.map((entry) => entry.review.id)).toEqual([review.id])
    expect((await getReviewDiscussion('member', review.id)).comments).toHaveLength(1)
    expect((await getReviewBookContext('author', 'v2')).own?.id).toBe(review.id)
    // Deleting the author's own read version never deletes work reviews;
    // provenance degrades while the other readable version keeps the thread open.
    await deleteCatalogVersion('owner', 'source', 'w1', 'l1')
    const degraded = await getReviewDiscussion('author', review.id)
    expect(degraded.review.provenance).toMatchObject({ listingId: 'l1', available: false, versionName: null })
    expect((await getReviewDiscussion('member', review.id)).comments).toHaveLength(1)
    // Trash closes shared reads; the author keeps rating, body, choice and discussion.
    await deleteCatalogBook('owner', 'source', 'w1')
    await expect(getReviewWorkContext('member', 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    const trashed = await getReviewBookContext('author', 'v2')
    expect(trashed.own?.visibility).toBe('shared')
    expect(trashed.summary).toBeNull()
    await updateReview('author', review.id, { visibility: 'private' })
    await restoreCatalogBook('owner', 'source', 'w1')
    await updateReview('author', review.id, { visibility: 'shared' })
    expect((await getReviewDiscussion('member', review.id)).comments).toHaveLength(1)
    expect((await getReviewWorkContext('member', 'source', 'w1')).summary).toMatchObject({ count: 1 })
  })

  it('leaves source reviews in place on fork and lets the local copy start its own private review', async () => {
    const review = await createReview('author', { bookVersionId: 'v2', rating: 4, visibility: 'shared' })
    db.insert(schema.blobs).values({ key: 'k-v2', kind: 'book', size: 1, createdAt: now }).run()
    vi.spyOn(storage, 'getStorage').mockReturnValue({ exists: async (key: string) => key === 'k-v2' } as ReturnType<typeof storage.getStorage>)
    const fork = await forkLocalBook('author', 'v2')
    expect(fork.bookVersionId).not.toBe('v2')
    expect((await getReviewDiscussion('member', review.id)).review.source?.libraryBookId).toBe('w1')
    const local = await createReview('author', { bookVersionId: fork.bookVersionId, body: 'local notes' })
    expect(local).toMatchObject({ visibility: 'private', source: null })
    expect((await myReviews('author')).entries).toHaveLength(2)
  })

  it('falls back to private on library deletion and stays reachable through the personal entry', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })
    await deleteLibrary('owner', 'source')
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, review.id)).get()).toMatchObject({ visibility: 'private' })
    await expect(getReviewWorkContext('member', 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    const mine = await myReviews('author')
    expect(mine.entries[0]).toMatchObject({ sourceStatus: 'library-deleted', workTitle: null })
    expect((await getReviewDiscussion('author', review.id)).review.visibility).toBe('private')
    await permanentDeleteCatalogBook('owner', 'source', 'w1').catch(() => undefined)
  })

  it('keeps the author copy after permanent source deletion with a reachable entry', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'kept', visibility: 'shared' })
    await deleteCatalogBook('owner', 'source', 'w1')
    await permanentDeleteCatalogBook('owner', 'source', 'w1')
    const mine = await myReviews('author')
    expect(mine.entries[0]).toMatchObject({ sourceStatus: 'deleted', workTitle: null })
    expect((await getReviewDiscussion('author', review.id)).review).toMatchObject({ rating: 4, body: 'kept' })
    await expect(getReviewWorkContext('member', 'source', 'w1')).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' })
    await deleteReview('author', review.id)
    expect((await myReviews('author')).entries).toHaveLength(0)
  })

  it('never reinterprets stored plain bodies and stores new bodies raw', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: '**not bold yet**', visibility: 'private' })
    expect(review.bodyFormat).toBe('markdown')
    db.update(schema.bookReviews).set({ bodyFormat: 'plain' }).where(eq(schema.bookReviews.id, review.id)).run()
    const updated = await updateReview('author', review.id, { body: '**still raw**' })
    expect(updated).toMatchObject({ body: '**still raw**', bodyFormat: 'plain' })
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, review.id)).get()?.body).toBe('**still raw**')
  })

  it('removes a deleted account reviews while promoting surviving review replies', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, visibility: 'shared' })
    const parent = await createReviewComment('outsider', review.id, { body: 'deleted account text' })
    await createReviewComment('member', review.id, { body: 'remaining reply', replyToId: parent })
    await setReviewLike('outsider', review.id, true)
    db.delete(schema.users).where(eq(schema.users.id, 'outsider')).run()
    const result = await getReviewDiscussion('member', review.id)
    expect(result.comments.find((row) => row.id === parent)).toBeUndefined()
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]).toMatchObject({ body: 'remaining reply', parentId: null })
    expect(result.review.likeCount).toBe(0)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    // Full account cleanup clears owned reviews and their dependent data while
    // replies on other readers' reviews already survived through the trigger above.
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'owner', createdAt: now, updatedAt: now }).run()
    const { deleteUser } = await import('../users/users.service')
    await deleteUser('owner', 'author')
    expect(db.select().from(schema.bookReviews).all()).toEqual([])
    expect(db.select().from(schema.bookReviewLikes).all()).toEqual([])
    expect(db.select().from(schema.bookReviewComments).all()).toEqual([])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades a populated pre-0046 database without losing rows', async () => {
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations')
    const previous = new Database(':memory:')
    try {
      previous.pragma('foreign_keys = ON')
      const previousDb = drizzle(previous, { schema })
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-reviews-'))
      try {
        fs.mkdirSync(path.join(scratch, 'meta'), { recursive: true })
        for (const name of fs.readdirSync(migrationsFolder).filter((n) => n.endsWith('.sql'))) {
          fs.copyFileSync(path.join(migrationsFolder, name), path.join(scratch, name))
        }
        fs.copyFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), path.join(scratch, 'meta', '_journal.json'))
        const journalPath = path.join(scratch, 'meta', '_journal.json')
        const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: Array<{ tag: string }> }
        journal.entries = journal.entries.slice(0, journal.entries.findIndex((entry) => entry.tag === '0046_book_reviews'))
        fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2))
        migrateBeforeBookRetirement(previousDb, { migrationsFolder: scratch })
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true })
      }
      previous.exec(`
        INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'u1', 'secret', 1);
        INSERT INTO instance (id, owner_user_id, created_at, updated_at) VALUES ('instance', 'u1', 1, 1);
        INSERT INTO libraries (id, user_id, type, name, description, created_at, updated_at)
          VALUES ('lib1', 'u1', 'shared', 'City', '', 1, 1);
        INSERT INTO library_books (id, library_id, user_id, title, author, authors, description, meta, created_at, updated_at)
          VALUES ('lb1', 'lib1', 'u1', 'Work', '', '[]', '', '{}', 1, 1);
        INSERT INTO book_versions (id, format, size, created_at, updated_at) VALUES ('bv1', 'epub', 1, 1, 1);
        INSERT INTO library_book_versions
          (id, library_id, library_book_id, book_version_id, kind, status, name, authors, meta, created_at, updated_at)
          VALUES ('lbv1', 'lib1', 'lb1', 'bv1', 'personal', 'published', '', '[]', '{}', 1, 1);
        INSERT INTO ideas (id, user_id, book_version_id, text, note, visibility, shared_library_id, created_at, updated_at)
          VALUES ('i1', 'u1', 'bv1', 't', 'n', 'shared', 'lib1', 1, 1);
      `)
      vi.spyOn(client, 'getDb').mockReturnValue(previousDb)
      await client.runDatabaseMigrations(previousDb)
      expect(previous.prepare('SELECT COUNT(*) AS count FROM ideas').get()).toEqual({ count: 1 })
      expect(previous.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_reviews'").get()).toBeDefined()
      expect(previous.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_review_comments'").get()).toBeDefined()
      expect(previous.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_review_likes'").get()).toBeDefined()
      expect(previous.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_review_comment_likes'").get()).toBeDefined()
      expect(previous.pragma('foreign_key_check')).toEqual([])
      expect(previous.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    } finally {
      previous.close()
    }
  })
})
