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
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

import { CONTENT_DRAFT_TTL_MS, contentFileUrl, reviewExcerpt, reviewFileReferences } from '@bookdock/shared'

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
import { listNotifications, markAllNotificationsRead, markNotificationRead, notificationTarget, unreadNotificationCount } from '../notifications/notifications.service'
import notificationRoutes from '../notifications/notifications.routes'
import contentFileRoutes from '../content-files/content-files.routes'
import { uploadContentFile } from '../content-files/content-files.service'
import { readableContentFile } from '../content-files/file-access'
import { cancelContentDraft, sweepContentFiles } from '../../lib/content-file-lifecycle'
import { createAnnotation, deleteAnnotation, updateAnnotation } from '../annotations/annotations.service'
import { createIdeaComment, deleteIdeaComment, setIdeaLike } from '../annotations/idea-discussion.service'
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
    // Uncollected readers can publish directly if they can read the work.
    const unheld = await createReview('outsider', { bookVersionId: 'v1', body: 'uncollected read', rating: 0.5, visibility: 'shared' })
    expect(unheld).toMatchObject({ rating: 0.5, body: 'uncollected read', visibility: 'shared' })
    await expect(createReview('member', { bookVersionId: 'v1', body: '   ', rating: null })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const ctx = await getReviewWorkContext('outsider', 'source', 'w1')
    expect(ctx.summary?.distribution).toHaveLength(10)
    expect(ctx.summary?.distribution.map((bucket) => bucket.rating)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
    expect(ctx.summary).toMatchObject({ average: 2.5, count: 2 })
  })

  it('stores an optional title without affecting statistics', async () => {
    const titled = await createReview('author', { bookVersionId: 'v1', rating: 4, title: '  A quiet reread  ', body: 'notes', visibility: 'shared' })
    expect(titled).toMatchObject({ title: 'A quiet reread' })
    expect((await getReviewWorkContext('outsider', 'source', 'w1')).summary).toMatchObject({ average: 4, count: 1 })
    const renamed = await updateReview('author', titled.id, { title: 'Second title' })
    expect(renamed).toMatchObject({ title: 'Second title' })
    expect(renamed.editedAt).not.toBeNull()
    await expect(updateReview('author', titled.id, { title: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(createReview('member', { bookVersionId: 'v1', title: 'Title alone', visibility: 'private' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const cleared = await updateReview('author', titled.id, { title: null })
    expect(cleared).toMatchObject({ title: null, rating: 4 })
  })

  it('marks edited only on real content changes and keeps publish order', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', rating: 4, body: 'Body text', visibility: 'shared' })
    expect(review).toMatchObject({ editedAt: null })
    const createdAt = review.createdAt
    // Rating-only change: updatedAt moves, editedAt stays empty.
    const rated = await updateReview('author', review.id, { rating: 5 })
    expect(rated).toMatchObject({ rating: 5, editedAt: null, createdAt })
    // Visibility-only change: same.
    const privated = await updateReview('author', review.id, { visibility: 'private' })
    expect(privated).toMatchObject({ visibility: 'private', editedAt: null, createdAt })
    // Identical body resubmit: same.
    const same = await updateReview('author', review.id, { body: 'Body text' })
    expect(same.editedAt).toBeNull()
    // Real body edit: editedAt set.
    const edited = await updateReview('author', review.id, { body: 'Body text v2' })
    expect(edited.editedAt).not.toBeNull()
    // Editing an old review never reorders the archive: newest stays by createdAt.
    const newer = await createReview('author', { bookVersionId: 'v3', rating: 3, body: 'Later work' })
    db.update(schema.bookReviews)
      .set({ createdAt: createdAt - 100000 })
      .where(eq(schema.bookReviews.id, review.id))
      .run()
    await updateReview('author', review.id, { body: 'Body text v3' })
    expect((await myReviews('author')).entries.map((entry) => entry.review.id)).toEqual([newer.id, review.id])
    // Identical comment resubmit leaves editedAt empty too.
    const commentId = await createReviewComment('member', newer.id, { body: 'same words', requestId: 'same_words_12345678' })
    await updateReviewComment('member', newer.id, commentId, 'same words')
    expect(db.select().from(schema.bookReviewComments).where(eq(schema.bookReviewComments.id, commentId)).get()).toMatchObject({ editedAt: null })
    await updateReviewComment('member', newer.id, commentId, 'changed words')
    expect(db.select().from(schema.bookReviewComments).where(eq(schema.bookReviewComments.id, commentId)).get()?.editedAt).not.toBeNull()
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
    await createReview('outsider', { bookVersionId: 'v1', body: 'no stars from me', visibility: 'shared' })
    const ctx = await getReviewWorkContext('member', 'source', 'w1')
    expect(ctx.summary).toMatchObject({ average: 5, count: 1 })
    expect(ctx.reviews.map((row) => row.author.name)).toEqual(['author', 'outsider'])
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

  it('persists notifications atomically and deduplicates retry receipts and like cycles', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: 'visible', visibility: 'shared' })
    const input = { body: 'comment', requestId: 'request_1234567890' }
    const commentId = await createReviewComment('member', review.id, input)
    expect(await createReviewComment('member', review.id, input)).toBe(commentId)
    await expect(createReviewComment('member', review.id, { ...input, body: 'changed' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await setReviewLike('member', review.id, true)
    await setReviewLike('member', review.id, true)
    await setReviewLike('member', review.id, false)
    expect((await unreadNotificationCount('author')).count).toBe(1)
    await setReviewLike('member', review.id, true)
    await setReviewLike('author', review.id, true)
    expect(db.select().from(schema.interactionNotifications).all()).toHaveLength(2)
    await deleteReviewComment('member', review.id, commentId)
    expect(await createReviewComment('member', review.id, input)).toBe(commentId)
    expect(db.select().from(schema.bookReviewComments).all()).toHaveLength(0)
    expect((await unreadNotificationCount('author')).count).toBe(1)
    sqlite.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON interaction_notifications BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    await expect(createReviewComment('critic', review.id, { body: 'rollback', requestId: 'rollback_123456789' })).rejects.toThrow('test failure')
    expect(db.select().from(schema.bookReviewComments).all()).toHaveLength(0)
    expect(db.select().from(schema.interactionReceipts).all()).toHaveLength(1)
    await expect(setReviewLike('critic', review.id, true)).rejects.toThrow('test failure')
    expect(db.select().from(schema.bookReviewLikes).all().some((row) => row.userId === 'critic')).toBe(false)
  })

  it('notifies only the addressed reply author and protects recipient ownership over HTTP', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: 'visible', visibility: 'shared' })
    const root = await createReviewComment('member', review.id, { body: 'root' })
    const reply = await createReviewComment('critic', review.id, { body: 'reply', replyToId: root })
    await createReviewComment('member', review.id, { body: 'self reply', replyToId: root })
    await setReviewLike('author', review.id, true, reply)
    expect((await unreadNotificationCount('author')).count).toBe(1)
    expect((await unreadNotificationCount('member')).count).toBe(1)
    expect((await unreadNotificationCount('critic')).count).toBe(1)
    const memberEvent = (await listNotifications('member', { page: 1, pageSize: 20 })).entries[0]
    expect(memberEvent).toMatchObject({ event: 'reply', commentId: reply, actor: { id: 'critic' } })
    expect(await notificationTarget('outsider', memberEvent.id)).toEqual({ available: false })
    markNotificationRead('outsider', memberEvent.id, true)
    expect((await unreadNotificationCount('member')).count).toBe(1)
    const anon = new Hono().onError(errorHandler).route('/notifications', notificationRoutes)
    expect((await anon.request('/notifications/unread')).status).toBe(401)
    const signed = new Hono().onError(errorHandler).use('*', async (c, next) => {
      c.set('user', { id: 'outsider' } as never); await next()
    }).route('/notifications', notificationRoutes)
    expect(await (await signed.request('/notifications/' + memberEvent.id + '/target')).json()).toEqual({ data: { available: false } })
    expect((await signed.request('/notifications?page=1')).status).toBe(200)
    expect((await signed.request('/notifications?pageSize=500')).status).toBe(400)
  })

  it('omits private or inaccessible notification targets and restores retained read state', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: 'sensitive', visibility: 'shared' })
    await createReviewComment('outsider', review.id, { body: 'sensitive interaction' })
    const entry = (await listNotifications('author', { page: 1, pageSize: 20 })).entries[0]
    await updateReview('author', review.id, { visibility: 'private' })
    expect((await listNotifications('author', { page: 1, pageSize: 20 })).entries).toEqual([])
    expect(await notificationTarget('author', entry.id)).toEqual({ available: false })
    await markAllNotificationsRead('author')
    expect(db.select().from(schema.interactionNotifications).get()?.readAt).toBeNull()
    await updateReview('author', review.id, { visibility: 'shared' })
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    expect((await unreadNotificationCount('author')).count).toBe(0)
    expect(await notificationTarget('author', entry.id)).toEqual({ available: false })
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, 'source')).run()
    expect((await unreadNotificationCount('author')).count).toBe(1)
    markNotificationRead('author', entry.id, true)
    await deleteCatalogBook('owner', 'source', 'w1')
    expect((await listNotifications('author', { page: 1, pageSize: 20 })).entries).toEqual([])
    await restoreCatalogBook('owner', 'source', 'w1')
    expect((await unreadNotificationCount('author')).count).toBe(0)
    expect((await listNotifications('author', { page: 1, pageSize: 20 })).entries[0].readAt).not.toBeNull()
    await deleteReview('author', review.id)
    expect(await notificationTarget('author', entry.id)).toEqual({ available: false })
  })

  it('paginates authorized notifications and marks all batches without skipping unread rows', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: 'visible', visibility: 'shared' })
    for (let i = 0; i < 57; i++) await createReviewComment('member', review.id, { body: String(i) })
    const first = await listNotifications('author', { page: 1, pageSize: 20 })
    const third = await listNotifications('author', { page: 3, pageSize: 20 })
    expect(first.entries).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(third.entries).toHaveLength(17)
    expect(third.hasMore).toBe(false)
    expect(new Set([...first.entries, ...third.entries].map((entry) => entry.id)).size).toBe(37)
    await markAllNotificationsRead('author')
    expect((await unreadNotificationCount('author')).count).toBe(0)
  })

  it('covers idea comments, replies and likes with exact-source checks and deletion receipts', async () => {
    db.insert(schema.ideas).values({
      id: 'notification-idea', userId: 'author', bookVersionId: 'v1', revisionId: 'r-v1', visibility: 'shared',
      sharedLibraryId: 'source', sourceLibraryBookVersionId: 'l1', text: 'quote', note: 'idea', createdAt: now, updatedAt: now,
    }).run()
    const input = { body: 'idea comment', requestId: 'idea_request_12345678' }
    const root = await createIdeaComment('member', 'notification-idea', input)
    expect(await createIdeaComment('member', 'notification-idea', input)).toBe(root)
    const reply = await createIdeaComment('critic', 'notification-idea', { body: 'reply', replyToId: root })
    await setIdeaLike('critic', 'notification-idea', true, root)
    await setIdeaLike('member', 'notification-idea', true)
    await setIdeaLike('member', 'notification-idea', true)
    expect((await unreadNotificationCount('author')).count).toBe(2)
    expect((await unreadNotificationCount('member')).count).toBe(2)
    const memberEvents = (await listNotifications('member', { page: 1, pageSize: 20 })).entries
    expect(memberEvents.some((entry) => entry.commentId === reply && entry.event === 'reply')).toBe(true)
    const ownerEvent = (await listNotifications('author', { page: 1, pageSize: 20 })).entries[0]
    db.update(schema.libraryBookVersions).set({ status: 'draft' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    expect(await notificationTarget('author', ownerEvent.id)).toEqual({ available: false })
    db.update(schema.libraryBookVersions).set({ status: 'published' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    await deleteIdeaComment('member', 'notification-idea', root)
    expect(await createIdeaComment('member', 'notification-idea', input)).toBe(root)
    expect(db.select().from(schema.ideaComments).all()).toHaveLength(1)
    db.update(schema.ideas).set({ visibility: 'private' }).where(eq(schema.ideas.id, 'notification-idea')).run()
    expect((await unreadNotificationCount('author')).count).toBe(0)
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'owner', createdAt: now, updatedAt: now }).run()
    const { deleteUser } = await import('../users/users.service')
    await deleteUser('owner', 'member')
    expect(db.select().from(schema.interactionReceipts).all()).toHaveLength(0)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('validates actual image/attachment bytes and retains failed upload drafts for retry', async () => {
    const context = { domain: 'review' as const, kind: 'image' as const, bookVersionId: 'v1', draftId: 'image_draft_123456789' }
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer()
    const image = new File([new Uint8Array(bytes)], 'image.png', { type: 'application/octet-stream' })
    const driver = storage.getStorage()
    vi.spyOn(driver, 'put').mockRejectedValueOnce(new Error('offline'))
    await expect(uploadContentFile('author', context, image)).rejects.toThrow('offline')
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(db.select().from(schema.blobs).all()).toHaveLength(0)
    const file = await uploadContentFile('author', context, image)
    expect(file.mimeType).toBe('image/webp')
    expect(file.url).toBe(contentFileUrl(file.id))
    const malformed = new File(['<svg><script>alert(1)</script></svg>'], 'fake.png', { type: 'image/png' })
    await expect(uploadContentFile('author', context, malformed)).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    await expect(uploadContentFile('author', { ...context, kind: 'attachment' }, new File(['not a PDF'], 'fake.pdf'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    await expect(uploadContentFile('author', { ...context, kind: 'attachment' }, new File([new Uint8Array([0xff, 0xfe])], 'fake.txt'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    const text = await uploadContentFile('author', { ...context, kind: 'attachment' }, new File(['中文 text'], 'readme.txt'))
    expect(text.mimeType).toBe('text/plain; charset=utf-8')
    const pdf = await PDFDocument.create()
    pdf.addPage()
    const attachment = await uploadContentFile('author', { ...context, kind: 'attachment' }, new File([new Uint8Array(await pdf.save())], 'readme.pdf'))
    expect(attachment.mimeType).toBe('application/pdf')
    await expect(readableContentFile('member', file.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
  })

  it('rejects expired drafts at upload and publication before the scheduled sweep', async () => {
    const context = { domain: 'review' as const, kind: 'attachment' as const, bookVersionId: 'v1', draftId: 'expired_draft_123456789' }
    const file = await uploadContentFile('author', context, new File(['kept until sweep'], 'draft.txt'))
    db.update(schema.contentUploadDrafts).set({ createdAt: Date.now() - CONTENT_DRAFT_TTL_MS - 1 }).run()
    await expect(uploadContentFile('author', context, new File(['late'], 'late.txt'))).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    await expect(createReview('author', { bookVersionId: 'v1', body: `[File](${file.url})`, draftId: context.draftId })).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(0)
    expect(await readableContentFile('author', file.id)).toMatchObject({ reviewId: null })
  })

  it('associates managed review files atomically and checks current ACL on every HTTP read', async () => {
    const context = { domain: 'review' as const, kind: 'attachment' as const, bookVersionId: 'v1', draftId: 'review_draft_123456789' }
    const file = await uploadContentFile('author', context, new File(['private attachment'], 'notes.txt'))
    await expect(createReview('author', { bookVersionId: 'v1', body: `[File](${file.url})\n![wrong kind](${file.url})`, draftId: context.draftId })).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(0)
    expect(await readableContentFile('author', file.id)).toMatchObject({ reviewId: null, ready: true })
    const body = `  # Heading\n\n[Notes](${file.url})\n\n`
    const review = await createReview('author', { bookVersionId: 'v1', body, draftId: context.draftId, visibility: 'shared' })
    expect(review.body).toBe(body)
    expect(review.files?.map((entry) => entry.id)).toEqual([file.id])
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => { const id = c.req.header('x-test-user'); c.set('user', id ? { id, username: id, role: 'member', avatarKey: null } : null); await next() })
    app.route('/api/v1/content-files', contentFileRoutes)
    for (const viewer of ['author', 'owner', 'admin', 'member', 'outsider']) {
      const response = await app.request(file.url, { headers: { 'x-test-user': viewer } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-disposition')).toContain('attachment;')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toBe('private attachment')
    }
    await updateReview('author', review.id, { visibility: 'private' })
    for (const viewer of ['owner', 'admin', 'member', 'outsider']) {
      const response = await app.request(file.url, { headers: { 'x-test-user': viewer } })
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('notes.txt')
    }
    expect((await app.request(file.url)).status).toBe(404)
    await updateReview('author', review.id, { visibility: 'shared' })
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'owner', allowGuestAccess: true, createdAt: now, updatedAt: now }).run()
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    expect((await app.request(file.url)).status).toBe(200)
    db.update(schema.instance).set({ allowGuestAccess: false }).run()
    expect((await app.request(file.url)).status).toBe(404)
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    await expect(readableContentFile('outsider', file.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect((await readableContentFile('author', file.id)).id).toBe(file.id)
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, 'source')).run()
    expect((await readableContentFile('outsider', file.id)).id).toBe(file.id)
    await cancelContentDraft('author', context.draftId)
    expect((await readableContentFile('member', file.id)).id).toBe(file.id)
    await updateReview('author', review.id, { body: 'File removed' })
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(db.select().from(schema.blobs).all()).toHaveLength(0)
  })

  it('keeps idea images plain-text and exact-listing scoped across edits and deletion', async () => {
    const context = { domain: 'idea' as const, kind: 'image' as const, bookVersionId: 'v1', draftId: 'idea_draft_123456789' }
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).png().toBuffer()
    const file = await uploadContentFile('author', context, new File([new Uint8Array(bytes)], 'image.png'))
    const idea = await createAnnotation('author', 'v1', { type: 'note', cfiRange: 'txt:0', note: '**literal plain text**', visibility: 'shared', draftId: context.draftId, imageIds: [file.id] })
    expect(idea.note).toBe('**literal plain text**')
    expect(idea.images?.[0].id).toBe(file.id)
    expect((await readableContentFile('member', file.id)).ideaId).toBe(idea.id)
    db.update(schema.libraryBookVersions).set({ status: 'draft' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    for (const viewer of ['member', 'outsider', 'author']) await expect(readableContentFile(viewer, file.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    db.update(schema.libraryBookVersions).set({ status: 'published' }).where(eq(schema.libraryBookVersions.id, 'l1')).run()
    expect((await readableContentFile('member', file.id)).id).toBe(file.id)
    await updateAnnotation('author', idea.id, { visibility: 'private' })
    await expect(readableContentFile('admin', file.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect((await readableContentFile('author', file.id)).id).toBe(file.id)
    await deleteAnnotation('author', idea.id)
    await expect(readableContentFile('author', file.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(db.select().from(schema.blobs).all()).toHaveLength(0)
  })

  it('reference-checks shared upload bytes before cancellation and expiration cleanup', async () => {
    const context = { domain: 'review' as const, kind: 'attachment' as const, bookVersionId: 'v1', draftId: 'shared_draft_123456789' }
    const file = new File(['same bytes'], 'shared.txt')
    const one = await uploadContentFile('author', context, file)
    const two = await uploadContentFile('member', context, file)
    expect(db.select().from(schema.blobs).all()).toHaveLength(1)
    const key = (await readableContentFile('member', two.id)).blobKey
    await cancelContentDraft('author', context.draftId)
    expect(await storage.getStorage().exists(key)).toBe(true)
    await expect(readableContentFile('author', one.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    await expect(uploadContentFile('author', context, file)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    await sweepContentFiles(Date.now() + CONTENT_DRAFT_TTL_MS + 1)
    expect(await storage.getStorage().exists(key)).toBe(false)
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(db.select().from(schema.blobs).all()).toHaveLength(0)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('rejects upload requests before parsing bytes when identity or qualification is missing', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => { const id = c.req.header('x-test-user'); c.set('user', id ? { id, username: id, role: 'member', avatarKey: null } : null); await next() })
    app.route('/api/v1/content-files', contentFileRoutes)
    const url = '/api/v1/content-files?domain=review&kind=image&bookVersionId=v1&draftId=http_draft_123456789'
    expect((await app.request(url, { method: 'POST', body: 'not multipart' })).status).toBe(401)
    const unauthUrl = '/api/v1/content-files?domain=review&kind=image&bookVersionId=va&draftId=http_draft_123456789'
    expect((await app.request(unauthUrl, { method: 'POST', headers: { 'x-test-user': 'outsider' }, body: 'not multipart' })).status).toBe(404)
    const body = new FormData()
    body.append('file', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }))
    expect((await app.request(url, { method: 'POST', headers: { 'x-test-user': 'author' }, body })).status).toBe(413)
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
  })

  it('cleans account-owned content while preserving another author sharing the same blob', async () => {
    const context = { domain: 'review' as const, kind: 'attachment' as const, bookVersionId: 'v1', draftId: 'account_draft_123456789' }
    const bytes = new File(['shared account bytes'], 'file.txt')
    const one = await uploadContentFile('author', context, bytes)
    const two = await uploadContentFile('member', context, bytes)
    const review = await createReview('author', { bookVersionId: 'v1', body: `[File](${one.url})`, visibility: 'shared', draftId: context.draftId })
    const key = (await readableContentFile('member', two.id)).blobKey
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'owner', createdAt: now, updatedAt: now }).run()
    const { deleteUser } = await import('../users/users.service')
    await deleteUser('owner', 'author')
    await expect(readableContentFile('member', one.id)).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, review.id)).get()).toBeUndefined()
    expect(await storage.getStorage().exists(key)).toBe(true)
    expect((await readableContentFile('member', two.id)).id).toBe(two.id)
    await cancelContentDraft('member', context.draftId)
    expect(await storage.getStorage().exists(key)).toBe(false)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('adds file persistence to populated review/notification structures without rewriting legacy bodies', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: '  **literal**\n', bodyFormat: 'plain', visibility: 'shared' })
    await createReviewComment('member', review.id, { body: 'before files', requestId: 'before_files_123456789' })
    sqlite.exec('DROP TABLE content_files; DROP TABLE content_upload_drafts; ALTER TABLE book_reviews DROP COLUMN title; ALTER TABLE book_states DROP COLUMN progress_data; ALTER TABLE book_states DROP COLUMN read_fraction; DELETE FROM __drizzle_migrations WHERE created_at >= 1792600000000')
    await client.runDatabaseMigrations(db)
    expect((await getReviewDiscussion('author', review.id)).review).toMatchObject({ body: '  **literal**\n', bodyFormat: 'plain', files: [] })
    expect((await unreadNotificationCount('author')).count).toBe(1)
    await client.runDatabaseMigrations(db)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
  })

  it('prevents uploads completing after cancellation from recreating draft files', async () => {
    const context = { domain: 'review' as const, kind: 'attachment' as const, bookVersionId: 'v1', draftId: 'cancel_draft_123456789' }
    const file = new File(['later bytes'], 'later.txt')
    let finish!: (value: ArrayBuffer) => void
    const buffer = await file.arrayBuffer()
    const read = vi.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const upload = uploadContentFile('author', context, file)
    const assertion = expect(upload).rejects.toMatchObject({ code: 'CONTENT_FILE_NOT_FOUND' })
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    await cancelContentDraft('author', context.draftId)
    finish(buffer)
    await assertion
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(db.select().from(schema.blobs).all()).toHaveLength(0)
  })

  it('preserves Markdown/plain semantics and excludes code, markup and resource IDs from excerpts', () => {
    const url = contentFileUrl('cfile_abcdefghijklmnopqrstu')
    const body = `# Heading\n\n**Text**\n\n| Label | Value |\n| --- | --- |\n| item | cell |\n\n\`\`\`text\nsecret long code ${url}\n\`\`\`\n\n![Image](${url})\n\n[Notes](${url})`
    expect(reviewFileReferences(body)).toEqual({ ids: ['cfile_abcdefghijklmnopqrstu'], imageIds: ['cfile_abcdefghijklmnopqrstu'], unmanagedImages: false })
    const excerpt = reviewExcerpt(body, 'markdown', 500)
    expect(excerpt).toBe('Heading Text Label Value item cell Notes')
    expect(reviewExcerpt('**literal**', 'plain')).toBe('**literal**')
    expect(reviewExcerpt('Hello **world**! 读**书**人', 'markdown')).toBe('Hello world! 读书人')
    expect(reviewFileReferences(`![external](https://example.com/image.png)`).unmanagedImages).toBe(true)
  })

  it('upgrades populated stage-one review structures into notification persistence', async () => {
    const review = await createReview('author', { bookVersionId: 'v1', body: 'baseline', visibility: 'shared' })
    sqlite.exec("DROP TABLE content_files; DROP TABLE content_upload_drafts; DROP TABLE interaction_notifications; DROP TABLE interaction_receipts; ALTER TABLE book_reviews DROP COLUMN title; ALTER TABLE book_states DROP COLUMN progress_data; ALTER TABLE book_states DROP COLUMN read_fraction; DELETE FROM __drizzle_migrations WHERE created_at >= 1792500000000")
    await client.runDatabaseMigrations(db)
    expect(db.select().from(schema.bookReviews).get()?.id).toBe(review.id)
    await createReviewComment('member', review.id, { body: 'upgrade event', requestId: 'upgrade_12345678901' })
    expect((await unreadNotificationCount('author')).count).toBe(1)
    await client.runDatabaseMigrations(db)
    expect(db.select().from(schema.interactionNotifications).all()).toHaveLength(1)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
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
