import Database from 'better-sqlite3'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActivityItem } from '@bookdock/shared'

import { runDatabaseMigrations } from '../../db/client'
import * as schema from '../../db/schema'
import { updateProfileSettings } from '../settings/settings.service'
import { listActivity } from './activity.service'

let sqlite: Database.Database
let db: ReturnType<typeof drizzle<typeof schema>>
const ids = { owner: 'owner', admin: 'admin', member: 'member', outsider: 'outsider' }
const libraryId = 'library'
const workId = 'work'
const bookVersionId = 'book-version'
const listingId = 'listing'

async function migrate() {
  await runDatabaseMigrations(db, { beforeRetarget: () => undefined })
  vi.spyOn(await import('../../db/client'), 'getDb').mockReturnValue(db)
}

function seedBase() {
  const now = 100
  db.insert(schema.users).values(Object.entries(ids).map(([id, username]) => ({ id, username, createdAt: now, updatedAt: now }))).run()
  db.insert(schema.libraries).values({ id: libraryId, userId: ids.owner, type: 'shared', name: 'Reading room', description: '', visibility: 'public', createdAt: now, updatedAt: now }).run()
  db.insert(schema.libraryMemberships).values([
    { id: 'admin-membership', libraryId, userId: ids.admin, role: 'admin', createdAt: now, updatedAt: now },
    { id: 'member-membership', libraryId, userId: ids.member, role: 'member', createdAt: now, updatedAt: now },
  ]).run()
  db.insert(schema.bookVersions).values({ id: bookVersionId, format: 'epub', size: 10, createdAt: now, updatedAt: now }).run()
  db.insert(schema.libraryBooks).values({ id: workId, libraryId, userId: ids.owner, title: 'Visible work', author: '', authors: [], description: '', createdAt: now, updatedAt: now }).run()
  db.insert(schema.libraryBookVersions).values({ id: listingId, libraryId, libraryBookId: workId, bookVersionId, kind: 'shared', status: 'published', createdAt: now, updatedAt: now }).run()
  db.insert(schema.ideas).values({ id: 'idea', userId: ids.owner, bookVersionId, text: 'An observation', note: 'A short note', visibility: 'shared', sharedLibraryId: libraryId, sourceLibraryBookVersionId: listingId, revisionId: null, createdAt: 123, updatedAt: 123, deletedAt: null }).run()
  db.insert(schema.bookReviews).values({ id: 'review', userId: ids.member, privateLibraryBookId: null, sourceLibraryId: libraryId, sourceLibraryBookId: workId, ratingHalves: 9, title: 'A title', body: '**Useful** review', bodyFormat: 'markdown', visibility: 'shared', readListingId: listingId, readBookVersionId: bookVersionId, readRevisionId: null, createdAt: 234, updatedAt: 234, editedAt: null }).run()
  updateProfileSettings(ids.owner, { showPublicActivity: true })
  db.insert(schema.activityEvents).values([
    { id: 'idea-event', idempotencyKey: 'idea.published:idea', eventType: 'idea.published', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: 'idea', workId, versionId: bookVersionId, occurredAt: 123 },
    { id: 'review-event', idempotencyKey: 'review.published:review', eventType: 'review.published', audience: 'library', libraryId, actorUserId: ids.member, targetKind: 'review', targetId: 'review', workId, versionId: bookVersionId, occurredAt: 234 },
    { id: 'management-event', idempotencyKey: 'work.deleted:1', eventType: 'work.deleted', audience: 'manager', libraryId, actorUserId: ids.admin, targetKind: 'work', targetId: 'deleted-work', workId: 'deleted-work', versionId: null, occurredAt: 345, snapshotWorkTitle: 'Removed work', snapshotObjectLabel: null, snapshotAuthorId: null },
  ]).run()
}

beforeEach(async () => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  db = drizzle(sqlite, { schema })
  await migrate()
  seedBase()
})
afterEach(() => { vi.restoreAllMocks(); sqlite?.close() })

describe('activity projections', () => {
  it('measures shared same-source idea projection statement growth', async () => {
    const idsToRemove: string[] = []
    for (let index = 1; index < 20; index += 1) {
      const id = `measure-idea-${index}`
      idsToRemove.push(id)
      db.insert(schema.ideas).values({ id, userId: ids.owner, bookVersionId, text: 'Measured', visibility: 'shared', sharedLibraryId: libraryId, sourceLibraryBookVersionId: listingId, revisionId: null, createdAt: 1000 + index, updatedAt: 1000 + index, deletedAt: null }).run()
      db.insert(schema.activityEvents).values({ id: `${id}-event`, idempotencyKey: `${id}-event`, eventType: 'idea.published', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: id, workId, versionId: bookVersionId, occurredAt: 1000 + index }).run()
    }
    const selectSpy = vi.spyOn(db, 'select')
    const allSpy = vi.spyOn(db, 'all')
    await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 50 })
    const manyCount = selectSpy.mock.calls.length + allSpy.mock.calls.length
    db.delete(schema.activityEvents).where(inArray(schema.activityEvents.targetId, idsToRemove)).run()
    db.delete(schema.ideas).where(inArray(schema.ideas.id, idsToRemove)).run()
    selectSpy.mockClear()
    allSpy.mockClear()
    await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 50 })
    const oneCount = selectSpy.mock.calls.length + allSpy.mock.calls.length
    expect(manyCount).toBe(oneCount)
  })

  it('keeps public profile activity opt-in and private profiles closed to visitors', async () => {
    updateProfileSettings(ids.owner, {})
    await expect(listActivity(ids.outsider, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    updateProfileSettings(ids.owner, { showPublicActivity: true, isPublic: false })
    await expect(listActivity(ids.outsider, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'all', limit: 20 })).items.map((item) => item.kind)).toEqual(['idea'])
  })

  it('merges private owner content into personal pages without exposing it through public or library feeds', async () => {
    updateProfileSettings(ids.owner, { showPublicActivity: true })
    db.update(schema.ideas).set({ visibility: 'private', createdAt: 1000 }).where(eq(schema.ideas.id, 'idea')).run()
    db.insert(schema.bookReviews).values({
      id: 'private-review', userId: ids.owner, privateLibraryBookId: null, sourceLibraryId: libraryId, sourceLibraryBookId: workId,
      ratingHalves: 7, title: 'Private review', body: 'Personal words', bodyFormat: 'plain', visibility: 'private',
      readListingId: null, readBookVersionId: bookVersionId, readRevisionId: null, createdAt: 123, updatedAt: 123, editedAt: null,
    }).run()

    const ownerPage = await listActivity(ids.owner, { scope: 'personal', type: 'all', limit: 1 })
    expect(ownerPage.items).toMatchObject([{
      kind: 'review', eventType: 'review.recorded', visibility: 'private', libraryId,
      target: { libraryBookId: workId, bookVersionId }, content: { workTitle: 'Visible work', libraryName: 'Reading room', title: 'Private review' },
    }])
    expect(ownerPage.nextCursor).toBeTruthy()
    const secondPage = await listActivity(ids.owner, { scope: 'personal', type: 'all', limit: 1, cursor: ownerPage.nextCursor! })
    expect(secondPage.items).toMatchObject([{
      kind: 'idea', eventType: 'idea.recorded', occurredAt: 123, visibility: 'private', libraryId,
      target: { ideaId: 'idea', libraryBookVersionId: null, bookVersionId }, content: { workTitle: '', libraryName: 'Reading room' },
    }])
    expect(secondPage.nextCursor).toBeNull()

    expect((await listActivity(ids.outsider, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).items).toEqual([])
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'catalog', limit: 20 })).items).toEqual([])
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'management', limit: 20 })).items).toEqual([])
    const libraryItems = (await listActivity(ids.admin, { scope: 'library', libraryId, type: 'all', limit: 20 })).items
    expect(libraryItems.map((item) => item.kind)).toEqual(['management', 'review'])
    expect(libraryItems.some((item) => item.eventId.startsWith('private-'))).toBe(false)
  })

  it('pages mixed public and private sources through over 100 unreadable candidates without gaps or duplicates', async () => {
    for (let index = 0; index < 105; index += 1) {
      db.insert(schema.activityEvents).values({
        id: `unreadable-${index}`, idempotencyKey: `unreadable-${index}`, eventType: 'idea.published', audience: 'library',
        libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: `missing-${index}`, workId, versionId: bookVersionId,
        occurredAt: 5000 - index,
      }).run()
    }
    db.insert(schema.bookReviews).values({
      id: 'owner-shared-review', userId: ids.owner, privateLibraryBookId: null, sourceLibraryId: libraryId, sourceLibraryBookId: workId,
      ratingHalves: 8, title: 'Shared review', body: 'Shared words', bodyFormat: 'plain', visibility: 'shared',
      readListingId: listingId, readBookVersionId: bookVersionId, readRevisionId: null, createdAt: 200, updatedAt: 200, editedAt: null,
    }).run()
    db.insert(schema.activityEvents).values({
      id: 'owner-shared-review-event', idempotencyKey: 'review.published:owner-shared-review', eventType: 'review.published',
      audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'review', targetId: 'owner-shared-review', workId,
      versionId: bookVersionId, occurredAt: 200,
    }).run()
    db.insert(schema.ideas).values({
      id: 'owner-private-idea', userId: ids.owner, bookVersionId: null, text: 'Private thought', visibility: 'private',
      sharedLibraryId: null, sourceLibraryBookVersionId: null, revisionId: null, createdAt: 200, updatedAt: 200, deletedAt: null,
    }).run()
    db.insert(schema.libraries).values({ id: 'mixed-private-library', userId: ids.owner, type: 'private', name: 'Private', description: '', visibility: 'private', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBooks).values({ id: 'mixed-private-work', libraryId: 'mixed-private-library', userId: ids.owner, title: 'Private work', author: '', authors: [], description: '', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.bookReviews).values({
      id: 'owner-private-review', userId: ids.owner, privateLibraryBookId: 'mixed-private-work', sourceLibraryId: null, sourceLibraryBookId: null,
      ratingHalves: null, title: null, body: 'Private words', bodyFormat: 'plain', visibility: 'private',
      readListingId: null, readBookVersionId: null, readRevisionId: null, createdAt: 200, updatedAt: 200, editedAt: null,
    }).run()

    const collected: ActivityItem[] = []
    let cursor: string | undefined
    do {
      const page = await listActivity(ids.owner, { scope: 'personal', type: 'all', limit: 1, ...(cursor ? { cursor } : {}) })
      collected.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(collected.map((item) => item.eventId).sort()).toEqual([
      'idea-event', 'owner-shared-review-event', 'private-idea:owner-private-idea', 'private-review:owner-private-review',
    ].sort())
    expect(new Set(collected.map((item) => item.eventId)).size).toBe(collected.length)
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })).items.map((item) => item.kind)).toEqual(['idea', 'idea'])
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'review', limit: 20 })).items.map((item) => item.kind)).toEqual(['review', 'review'])
  })

  it('keeps private rows owner-only across visibility flips, deletion and group lookup', async () => {
    updateProfileSettings(ids.owner, { showPublicActivity: false })
    db.insert(schema.ideas).values({
      id: 'flip-idea', userId: ids.owner, bookVersionId, text: 'Flip note', visibility: 'private', sharedLibraryId: libraryId,
      sourceLibraryBookVersionId: listingId, revisionId: null, createdAt: 10, updatedAt: 10, deletedAt: null,
    }).run()
    const ownPrivate = await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })
    expect(ownPrivate.items.find((item) => item.eventId === 'private-idea:flip-idea')).toMatchObject({ eventType: 'idea.recorded', occurredAt: 10 })
    await expect(listActivity(ids.outsider, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })

    updateProfileSettings(ids.owner, { showPublicActivity: true })
    db.update(schema.ideas).set({ visibility: 'shared' }).where(eq(schema.ideas.id, 'flip-idea')).run()
    db.insert(schema.activityEvents).values({
      id: 'flip-idea-event', idempotencyKey: 'idea.published:flip-idea', eventType: 'idea.published', audience: 'library',
      libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: 'flip-idea', workId, versionId: bookVersionId, occurredAt: 700,
    }).run()
    const shared = await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })
    expect(shared.items.filter((item) => item.eventId === 'flip-idea-event' || item.eventId === 'private-idea:flip-idea')).toHaveLength(1)
    expect(shared.items.find((item) => item.eventId === 'flip-idea-event')?.occurredAt).toBe(700)

    db.update(schema.ideas).set({ visibility: 'private' }).where(eq(schema.ideas.id, 'flip-idea')).run()
    const privateAgain = await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })
    expect(privateAgain.items.filter((item) => item.eventId === 'flip-idea-event' || item.eventId === 'private-idea:flip-idea')).toHaveLength(1)
    expect(privateAgain.items.find((item) => item.eventId === 'private-idea:flip-idea')?.occurredAt).toBe(700)
    expect((await listActivity(ids.outsider, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).items.some((item) => item.eventId === 'private-idea:flip-idea')).toBe(false)
    expect((await listActivity(ids.admin, { scope: 'personal', userId: ids.owner, type: 'all', limit: 20 })).items.some((item) => item.eventId === 'private-idea:flip-idea')).toBe(false)
    expect((await listActivity(ids.admin, { scope: 'library', libraryId, type: 'all', limit: 20 })).items.some((item) => item.eventId === 'private-idea:flip-idea')).toBe(false)
    await expect(listActivity(ids.admin, { scope: 'library', libraryId, type: 'all', groupEventId: 'private-idea:flip-idea', limit: 20 })).rejects.toMatchObject({ code: 'ACTIVITY_NOT_FOUND' })

    db.update(schema.ideas).set({ deletedAt: 900 }).where(eq(schema.ideas.id, 'flip-idea')).run()
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })).items.some((item) => item.eventId === 'private-idea:flip-idea')).toBe(false)
  })

  it('uses private copies or reading archives for private titles and excludes pending purge versions', async () => {
    db.insert(schema.libraries).values({ id: 'owner-private-library', userId: ids.owner, type: 'private', name: 'Private', description: '', visibility: 'private', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBooks).values({ id: 'owner-private-work', libraryId: 'owner-private-library', userId: ids.owner, title: 'Private copy title', author: '', authors: [], description: '', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBooks).values({ id: 'owner-private-work-no-version', libraryId: 'owner-private-library', userId: ids.owner, title: 'Old private work', author: '', authors: [], description: '', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBookVersions).values({ id: 'owner-private-listing', libraryId: 'owner-private-library', libraryBookId: 'owner-private-work', bookVersionId, kind: 'personal', status: 'published', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.ideas).values({ id: 'private-copy-idea', userId: ids.owner, bookVersionId, text: 'Private note', visibility: 'private', sharedLibraryId: null, sourceLibraryBookVersionId: null, revisionId: null, createdAt: 300, updatedAt: 300, deletedAt: null }).run()
    const withPrivateTitle = await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })
    expect(withPrivateTitle.items.find((item) => item.eventId === 'private-idea:private-copy-idea')).toMatchObject({ content: { workTitle: 'Private copy title' } })

    db.insert(schema.readingArchives).values({ userId: ids.owner, bookVersionId: 'archive-version', title: 'Owner archive title', author: '', format: 'epub', coverKey: null, legacyIntervals: [], legacyDaily: [], legacyWordCount: null, legacyRevisionId: null, createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.bookVersions).values({ id: 'archive-version', format: 'epub', size: 10, createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.ideas).values({ id: 'archive-idea', userId: ids.owner, bookVersionId: 'archive-version', text: 'Archived', visibility: 'private', sharedLibraryId: null, sourceLibraryBookVersionId: null, revisionId: null, createdAt: 301, updatedAt: 301, deletedAt: null }).run()
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })).items.find((item) => item.eventId === 'private-idea:archive-idea')).toMatchObject({ content: { workTitle: 'Owner archive title' } })
    db.insert(schema.ideas).values({ id: 'no-version-idea', userId: ids.owner, bookVersionId: null, text: 'No source', visibility: 'private', sharedLibraryId: null, sourceLibraryBookVersionId: null, revisionId: null, createdAt: 302, updatedAt: 302, deletedAt: null }).run()
    expect((await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })).items.find((item) => item.eventId === 'private-idea:no-version-idea')).toMatchObject({ target: { bookVersionId: null }, content: { workTitle: '' } })

    db.insert(schema.bookReviews).values({ id: 'pending-review', userId: ids.owner, privateLibraryBookId: 'owner-private-work', sourceLibraryId: null, sourceLibraryBookId: null, ratingHalves: null, title: 'Pending', body: 'Pending review', bodyFormat: 'plain', visibility: 'private', readListingId: 'owner-private-listing', readBookVersionId: bookVersionId, readRevisionId: null, createdAt: 303, updatedAt: 303, editedAt: null }).run()
    db.insert(schema.bookReviews).values({ id: 'pending-review-without-version', userId: ids.owner, privateLibraryBookId: 'owner-private-work-no-version', sourceLibraryId: null, sourceLibraryBookId: null, ratingHalves: null, title: 'Pending old review', body: 'Pending review', bodyFormat: 'plain', visibility: 'private', readListingId: null, readBookVersionId: null, readRevisionId: null, createdAt: 304, updatedAt: 304, editedAt: null }).run()

    db.update(schema.libraryBooks).set({ deletedAt: 400, meta: {} }).where(eq(schema.libraryBooks.id, 'owner-private-work')).run()
    db.update(schema.libraryBooks).set({ deletedAt: 400, meta: {} }).where(eq(schema.libraryBooks.id, 'owner-private-work-no-version')).run()
    const afterOrdinaryTrash = await listActivity(ids.owner, { scope: 'personal', type: 'idea', limit: 20 })
    expect(afterOrdinaryTrash.items.find((item) => item.eventId === 'private-idea:private-copy-idea')).toMatchObject({ content: { workTitle: 'Private copy title' } })
    db.update(schema.libraryBooks).set({ meta: { pendingUserDataDeletion: true } }).where(eq(schema.libraryBooks.id, 'owner-private-work')).run()
    db.update(schema.libraryBooks).set({ meta: { pendingUserDataDeletion: true } }).where(eq(schema.libraryBooks.id, 'owner-private-work-no-version')).run()
    const afterPendingPurge = await listActivity(ids.owner, { scope: 'personal', type: 'all', limit: 20 })
    expect(afterPendingPurge.items.map((item) => item.eventId)).not.toContain('private-idea:private-copy-idea')
    expect(afterPendingPurge.items.map((item) => item.eventId)).not.toContain('private-review:pending-review')
    expect(afterPendingPurge.items.map((item) => item.eventId)).not.toContain('private-review:pending-review-without-version')
  })

  it('filters private, retained-unreadable and exact-source content before paging for every role', async () => {
    db.insert(schema.activityEvents).values({ id: 'private-event', idempotencyKey: 'private-event', eventType: 'idea.published', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: 'private-idea', workId, versionId: bookVersionId, occurredAt: 999 }).run()
    db.insert(schema.ideas).values({ id: 'private-idea', userId: ids.owner, bookVersionId, text: 'private', visibility: 'private', sharedLibraryId: null, sourceLibraryBookVersionId: null, createdAt: 999, updatedAt: 999, deletedAt: null }).run()
    const memberPage = await listActivity(ids.member, { scope: 'library', libraryId, type: 'all', limit: 20 })
    expect(memberPage.items.map((item) => item.kind)).toEqual(['review', 'idea'])
    expect(memberPage.items.find((item) => item.kind === 'idea')).toMatchObject({ target: { libraryBookVersionId: listingId }, content: { workTitle: 'Visible work', libraryName: 'Reading room' } })
    expect(memberPage.items.find((item) => item.kind === 'review')).toMatchObject({ content: { excerpt: 'Useful review' } })
    const managerPage = await listActivity(ids.admin, { scope: 'library', libraryId, type: 'all', limit: 20 })
    expect(managerPage.canManage).toBe(true)
    expect(managerPage.items.map((item) => item.kind)).toEqual(['management', 'review', 'idea'])
    db.insert(schema.bookReviews).values({ id: 'retained-review', userId: ids.outsider, privateLibraryBookId: null, sourceLibraryId: libraryId, sourceLibraryBookId: workId, ratingHalves: null, title: null, body: 'Retained', bodyFormat: 'plain', visibility: 'shared', readListingId: null, readBookVersionId: bookVersionId, readRevisionId: null, createdAt: 500, updatedAt: 500, editedAt: null }).run()
    db.insert(schema.activityEvents).values({ id: 'retained-review-event', idempotencyKey: 'retained-review-event', eventType: 'review.published', audience: 'library', libraryId, actorUserId: ids.outsider, targetKind: 'review', targetId: 'retained-review', workId, versionId: bookVersionId, occurredAt: 500 }).run()
    updateProfileSettings(ids.outsider, { showPublicActivity: true })
    expect((await listActivity(ids.outsider, { scope: 'personal', type: 'review', limit: 20 })).items).toHaveLength(1)
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, libraryId)).run()
    expect((await listActivity(ids.outsider, { scope: 'personal', type: 'review', limit: 20 })).items).toEqual([])
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, libraryId)).run()
    db.insert(schema.libraries).values({ id: 'sibling-library', userId: ids.owner, type: 'shared', name: 'Sibling', description: '', visibility: 'public', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBooks).values({ id: 'sibling-work', libraryId: 'sibling-library', userId: ids.owner, title: 'Same file elsewhere', author: '', authors: [], description: '', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.libraryBookVersions).values({ id: 'sibling-listing', libraryId: 'sibling-library', libraryBookId: 'sibling-work', bookVersionId, kind: 'shared', status: 'published', createdAt: 100, updatedAt: 100 }).run()
    db.insert(schema.activityEvents).values({ id: 'rebound-idea', idempotencyKey: 'rebound-idea', eventType: 'idea.published', audience: 'library', libraryId: 'sibling-library', actorUserId: ids.owner, targetKind: 'idea', targetId: 'idea', workId: 'sibling-work', versionId: bookVersionId, occurredAt: 500 }).run()
    expect((await listActivity(ids.member, { scope: 'library', libraryId: 'sibling-library', type: 'idea', limit: 20 })).items).toEqual([])
  })

  it('enforces manager rights on each request and binds cursors to their viewer and target', async () => {
    for (const [id, at] of [['idea-2', 400], ['idea-3', 300]] as const) {
      db.insert(schema.ideas).values({ id, userId: ids.owner, bookVersionId, text: id, visibility: 'shared', sharedLibraryId: libraryId, sourceLibraryBookVersionId: listingId, createdAt: at, updatedAt: at, deletedAt: null }).run()
      db.insert(schema.activityEvents).values({ id: `${id}-event`, idempotencyKey: `${id}-event`, eventType: 'idea.published', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'idea', targetId: id, workId, versionId: bookVersionId, occurredAt: at }).run()
    }
    const page = await listActivity(ids.member, { scope: 'library', libraryId, type: 'idea', limit: 1 })
    expect(page.nextCursor).toBeTruthy()
    await expect(listActivity(ids.outsider, { scope: 'library', libraryId, type: 'idea', limit: 1, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const managerPage = await listActivity(ids.admin, { scope: 'library', libraryId, type: 'management', limit: 20 })
    expect(managerPage.items.map((item) => item.kind)).toEqual(['management'])
    db.delete(schema.libraryMemberships).where(eq(schema.libraryMemberships.userId, ids.admin)).run()
    expect((await listActivity(ids.admin, { scope: 'library', libraryId, type: 'management', limit: 20 })).items).toEqual([])
  })

  it('uses the current listing name as the catalog activity label', async () => {
    db.update(schema.libraryBookVersions).set({ name: 'Named edition' }).where(eq(schema.libraryBookVersions.id, listingId)).run()
    db.insert(schema.activityEvents).values({
      id: 'named-version-event', idempotencyKey: 'named-version-event', eventType: 'version.added', audience: 'library',
      libraryId, actorUserId: ids.owner, targetKind: 'version', targetId: listingId, workId, versionId: bookVersionId, occurredAt: 900,
    }).run()
    const page = await listActivity(ids.member, { scope: 'library', libraryId, type: 'catalog', limit: 20 })
    expect(page.items.find((item) => item.eventId === 'named-version-event')).toMatchObject({
      kind: 'catalog', content: { objectLabel: 'Named edition' },
    })
  })

  it('retains manager audit rows when an actor account is deleted, then cascades with the library', async () => {
    db.insert(schema.activityEvents).values({
      id: 'deleted-actor-event', idempotencyKey: 'deleted-actor-event', eventType: 'review.deleted', audience: 'manager',
      libraryId, actorUserId: ids.admin, targetKind: 'review', targetId: 'removed-review', workId, versionId: bookVersionId,
      occurredAt: 901, snapshotWorkTitle: 'Visible work', snapshotObjectLabel: 'Review label', snapshotAuthorId: ids.admin,
    }).run()

    db.delete(schema.users).where(eq(schema.users.id, ids.admin)).run()
    expect(db.select().from(schema.activityEvents).where(eq(schema.activityEvents.id, 'deleted-actor-event')).get()).toMatchObject({
      actorUserId: ids.admin, snapshotAuthorId: ids.admin, snapshotWorkTitle: 'Visible work', snapshotObjectLabel: 'Review label',
    })
    const page = await listActivity(ids.owner, { scope: 'library', libraryId, type: 'management', limit: 20 })
    expect(page.items.find((item) => item.eventId === 'deleted-actor-event')).toMatchObject({
      kind: 'management', actor: { id: null, name: '账号不可用' }, target: { authorId: null },
    })

    db.delete(schema.libraries).where(eq(schema.libraries.id, libraryId)).run()
    expect(db.select().from(schema.activityEvents).where(eq(schema.activityEvents.id, 'deleted-actor-event')).get()).toBeUndefined()
  })

  it('groups only readable operation children and paginates child pages without skipping them', async () => {
    for (let index = 1; index <= 225; index += 1) {
      const versionId = `batch-version-${index}`
      const childListingId = `batch-listing-${index}`
      db.insert(schema.bookVersions).values({ id: versionId, format: 'epub', size: 1, createdAt: index, updatedAt: index }).run()
      db.insert(schema.libraryBookVersions).values({ id: childListingId, libraryId, libraryBookId: workId, bookVersionId: versionId, kind: 'shared', status: index <= 25 ? 'published' : 'draft', name: index === 25 ? 'Named batch version' : '', createdAt: index, updatedAt: index }).run()
      db.insert(schema.activityEvents).values({ id: `batch-event-${index}`, idempotencyKey: `batch-event-${index}`, eventType: 'version.added', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'version', targetId: childListingId, workId, versionId, operationId: 'batch-operation', occurredAt: 1000 + index }).run()
    }
    db.insert(schema.activityEvents).values({ id: 'standalone-work-event', idempotencyKey: 'standalone-work-event', eventType: 'work.added', audience: 'library', libraryId, actorUserId: ids.owner, targetKind: 'work', targetId: workId, workId, versionId: null, occurredAt: 500 }).run()
    const selectSpy = vi.spyOn(db, 'select')
    const feed = await listActivity(ids.member, { scope: 'library', libraryId, type: 'catalog', limit: 1 })
    expect(selectSpy.mock.calls.length).toBeLessThan(40)
    const group = feed.items.find((item) => item.kind === 'catalog-group')
    expect(group).toMatchObject({ count: 25, preview: expect.any(Array) })
    if (!group || group.kind !== 'catalog-group') throw new Error('Expected catalog group')
    expect(group.preview[0]).toMatchObject({ objectLabel: 'Named batch version' })
    const seen = new Set<string>()
    const afterGroup = await listActivity(ids.member, { scope: 'library', libraryId, type: 'catalog', limit: 1, cursor: feed.nextCursor! })
    expect(afterGroup.items.map((item) => item.eventId)).toEqual(['standalone-work-event'])
    let cursor: string | undefined
    do {
      selectSpy.mockClear()
      const page = await listActivity(ids.member, { scope: 'library', libraryId, type: 'catalog', groupEventId: group.eventId, limit: 10, ...(cursor ? { cursor } : {}) })
      expect(selectSpy.mock.calls.length).toBeLessThan(40)
      for (const item of page.items) {
        if (item.kind === 'catalog') seen.add(item.eventId)
      }
      const namedChild = page.items.find((item) => item.eventId === 'batch-event-25')
      if (namedChild) expect(namedChild).toMatchObject({ kind: 'catalog', content: { objectLabel: 'Named batch version' } })
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen.size).toBe(25)
  })

  it('does not expose works hidden by their category and groups system cleanup rows with a null actor', async () => {
    db.insert(schema.libraryCategories).values({ id: 'hidden-category', libraryId, userId: ids.owner, name: 'Hidden', parentId: null, sortOrder: 0, hidden: true, createdAt: 100, updatedAt: 100 }).run()
    db.update(schema.libraryBooks).set({ categoryId: 'hidden-category' }).where(eq(schema.libraryBooks.id, workId)).run()
    const hiddenPage = await listActivity(ids.member, { scope: 'library', libraryId, type: 'all', limit: 20 })
    expect(hiddenPage.items).toEqual([])
    const managerPage = await listActivity(ids.admin, { scope: 'library', libraryId, type: 'all', limit: 20 })
    expect(managerPage.items.map((item) => item.kind)).toContain('management')
    db.insert(schema.activityEvents).values({ id: 'system-delete-1', idempotencyKey: 'system-delete-1', eventType: 'work.deleted', audience: 'manager', libraryId, actorUserId: null, targetKind: 'work', targetId: 'deleted-1', workId: 'deleted-1', occurredAt: 4000, operationId: 'system-cleanup', snapshotWorkTitle: 'Old 1' }).run()
    db.insert(schema.activityEvents).values({ id: 'system-delete-2', idempotencyKey: 'system-delete-2', eventType: 'work.deleted', audience: 'manager', libraryId, actorUserId: null, targetKind: 'work', targetId: 'deleted-2', workId: 'deleted-2', occurredAt: 3999, operationId: 'system-cleanup', snapshotWorkTitle: 'Old 2' }).run()
    const afterCleanup = await listActivity(ids.admin, { scope: 'library', libraryId, type: 'management', limit: 20 })
    expect(afterCleanup.items[0]).toMatchObject({ kind: 'management-group', actor: { id: null, name: '系统' }, count: 2 })
  })
})
