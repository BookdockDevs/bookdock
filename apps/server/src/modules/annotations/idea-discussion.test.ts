import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import * as storage from '../../storage'
import { IDEA_DISCUSSION_TAG, migrateBeforeBookRetirement } from '../../db/migration-stage'
import { createAnnotation, deleteAnnotation, listAnnotations, searchAnnotations, updateAnnotation } from './annotations.service'
import { deleteBook } from '../books/books.service'
import { forkLocalBook } from '../libraries/fork.service'
import { ideaComposerContext } from './idea-access'
import { createIdeaComment, deleteIdeaComment, getIdeaDiscussion, listReaderIdeas, setIdeaLike, updateIdeaComment } from './idea-discussion.service'

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations')

describe('idea source authorization and discussion', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>
  const now = 1000
  const request = { cfiRange: 'epubcfi(/6/2!/4/2)', type: 'note' as const, text: 'quote', note: 'idea', revisionId: 'rev' }
  const source = { libraryId: 'source', listingId: 'listing', bookId: 'version', revisionId: 'rev' }

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    for (const id of ['author', 'member', 'outsider', 'manager']) db.insert(schema.users).values({ id, username: id, createdAt: now }).run()
    for (const id of ['source', 'other-library']) db.insert(schema.libraries).values({ id, userId: 'manager', type: 'shared', name: id, visibility: 'public', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraries).values({ id: 'private', userId: 'author', type: 'private', name: 'private', createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryMemberships).values({ id: 'membership', libraryId: 'source', userId: 'member', role: 'member', createdAt: now, updatedAt: now }).run()
    db.insert(schema.bookVersions).values({ id: 'version', format: 'epub', size: 1, createdAt: now, updatedAt: now }).run()
    db.insert(schema.contentRevisions).values({ id: 'rev', bookVersionId: 'version', revisionNo: 1, blobKey: 'file.epub', size: 1, createdAt: now }).run()
    for (const [libraryId, id] of [['source', 'listing'], ['other-library', 'other-listing'], ['private', 'collected']]) {
      db.insert(schema.libraryBooks).values({ id: `${id}-work`, libraryId, userId: 'author', title: 'Book', createdAt: now, updatedAt: now }).run()
      db.insert(schema.libraryBookVersions).values({ id, libraryId, libraryBookId: `${id}-work`, bookVersionId: 'version', kind: libraryId === 'private' ? 'shared' : 'personal', sourceLibraryId: libraryId === 'private' ? 'source' : null, sourceLibraryBookVersionId: libraryId === 'private' ? 'listing' : null, pinnedRevisionId: libraryId === 'private' ? 'rev' : null, createdAt: now, updatedAt: now }).run()
    }
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  it('defaults a collected non-member B to public and remembers only successful new ideas', async () => {
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ eligible: true, defaultVisibility: 'shared' })
    await expect(ideaComposerContext('outsider', 'unknown-version')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const first = await createAnnotation('author', 'version', { ...request, visibility: 'private' })
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ defaultVisibility: 'private' })
    await updateAnnotation('author', first.id, { visibility: 'shared' })
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ defaultVisibility: 'private' })
    await expect(createAnnotation('author', 'version', { ...request, visibility: 'shared', revisionId: 'wrong' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ defaultVisibility: 'private' })
    const publicIdea = await createAnnotation('author', 'version', { ...request, visibility: 'shared' })
    expect(publicIdea).toMatchObject({ visibility: 'shared', revisionId: 'rev' })
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, publicIdea.id)).get()).toMatchObject({ sharedLibraryId: 'source', sourceLibraryBookVersionId: 'listing' })
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ defaultVisibility: 'shared' })
  })

  it('keeps direct-reading ideas private and public ideas out of others personal/AI queries', async () => {
    const direct = await createAnnotation('member', 'version', { ...request, revisionId: undefined })
    expect(direct.visibility).toBe('private')
    await expect(createAnnotation('member', 'version', { ...request, visibility: 'shared' })).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    await createAnnotation('author', 'version', request)
    expect(await listAnnotations('outsider', 'version')).toEqual([])
    expect(await searchAnnotations('outsider', 'version', 'quote')).toEqual([])
    expect(await listReaderIdeas('outsider', source)).toHaveLength(1)
    expect(await listReaderIdeas('outsider', { ...source, libraryId: 'other-library', listingId: 'other-listing' })).toEqual([])
  })

  it('supports private discussion only for its author, including unique likes and two-level replies', async () => {
    const idea = await createAnnotation('author', 'version', { ...request, visibility: 'private' })
    const parent = await createIdeaComment('author', idea.id, { body: 'first' })
    const reply = await createIdeaComment('author', idea.id, { body: 'second', replyToId: parent })
    const nested = await createIdeaComment('author', idea.id, { body: 'third', replyToId: reply })
    await setIdeaLike('author', idea.id, true)
    await setIdeaLike('author', idea.id, true)
    await setIdeaLike('author', idea.id, true, nested)
    const discussion = await getIdeaDiscussion('author', idea.id)
    expect(discussion.idea.likeCount).toBe(1)
    expect(discussion.comments.find((comment) => comment.id === nested)).toMatchObject({ parentId: parent, replyToId: reply, replyToName: 'author', likeCount: 1 })
    for (const user of ['member', 'outsider', 'manager']) {
      await expect(getIdeaDiscussion(user, idea.id)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
      await expect(createIdeaComment(user, idea.id, { body: 'denied' })).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
      await expect(deleteAnnotation(user, idea.id)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    }
    await setIdeaLike('author', idea.id, false)
    expect((await getIdeaDiscussion('author', idea.id)).idea.likeCount).toBe(0)
  })

  it('allows members and readable non-members to interact; private transitions preserve discussion', async () => {
    const idea = await createAnnotation('author', 'version', request)
    const comment = await createIdeaComment('outsider', idea.id, { body: 'discussion' })
    await createIdeaComment('member', idea.id, { body: 'reply', replyToId: comment })
    await setIdeaLike('outsider', idea.id, true)
    await updateAnnotation('author', idea.id, { visibility: 'private' })
    await expect(getIdeaDiscussion('outsider', idea.id)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    expect((await getIdeaDiscussion('author', idea.id)).comments).toHaveLength(2)
    await updateAnnotation('author', idea.id, { visibility: 'shared' })
    expect((await getIdeaDiscussion('member', idea.id)).idea.likeCount).toBe(1)
    await expect(updateIdeaComment('manager', idea.id, comment, 'changed')).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    await updateIdeaComment('outsider', idea.id, comment, 'edited')
    expect((await getIdeaDiscussion('member', idea.id)).comments[0].editedAt).toEqual(expect.any(Number))
  })

  it('promotes surviving replies with no scar and allows managers to delete public content with cascades', async () => {
    const idea = await createAnnotation('author', 'version', request)
    const comment = await createIdeaComment('outsider', idea.id, { body: 'discussion' })
    await createIdeaComment('member', idea.id, { body: 'reply', replyToId: comment })
    await setIdeaLike('member', idea.id, true, comment)
    await deleteIdeaComment('manager', idea.id, comment)
    const discussion = await getIdeaDiscussion('member', idea.id)
    expect(discussion.comments).toHaveLength(1)
    expect(discussion.comments[0]).toMatchObject({ body: 'reply', parentId: null })
    await deleteAnnotation('manager', idea.id)
    expect(db.select().from(schema.ideaComments).all()).toEqual([])
    expect(db.select().from(schema.ideaLikes).all()).toEqual([])
    expect(db.select().from(schema.ideaCommentLikes).all()).toEqual([])
  })

  it('rechecks exact-source permissions and fails closed on mismatched revisions and replaced listings', async () => {
    const idea = await createAnnotation('author', 'version', request)
    expect((await listReaderIdeas('member', { ...source, revisionId: 'other-revision' }))[0].locationAvailable).toBe(false)
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, 'source')).run()
    await expect(getIdeaDiscussion('outsider', idea.id)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    await expect(setIdeaLike('outsider', idea.id, true)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    await expect(createAnnotation('author', 'version', request)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect((await listReaderIdeas('member', source))[0].annotation.id).toBe(idea.id)
    db.delete(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, 'listing')).run()
    await expect(getIdeaDiscussion('member', idea.id)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, idea.id)).get()?.visibility).toBe('shared')
  })

  it('retains original-source discussion after leaving and removing B, including personal-data cleanup', async () => {
    const idea = await createAnnotation('author', 'version', request)
    await createIdeaComment('member', idea.id, { body: 'survives' })
    db.insert(schema.libraryMemberships).values({ id: 'author-membership', libraryId: 'source', userId: 'author', role: 'member', createdAt: now, updatedAt: now }).run()
    db.delete(schema.libraryMemberships).where(eq(schema.libraryMemberships.id, 'author-membership')).run()
    expect((await getIdeaDiscussion('outsider', idea.id)).comments).toHaveLength(1)
    await deleteBook('author', 'version', { deleteUserData: true })
    expect((await getIdeaDiscussion('member', idea.id)).comments[0].body).toBe('survives')
    expect(await ideaComposerContext('author', 'version')).toMatchObject({ eligible: false })
    await updateAnnotation('author', idea.id, { note: 'still editable with source read access' })
    expect((await getIdeaDiscussion('member', idea.id)).idea.annotation.note).toBe('still editable with source read access')
  })

  it('leaves source-bound discussion on its original version when B becomes local C', async () => {
    const idea = await createAnnotation('author', 'version', request)
    await createIdeaComment('member', idea.id, { body: 'original source' })
    db.insert(schema.blobs).values({ key: 'file.epub', kind: 'book', size: 1, createdAt: now }).run()
    vi.spyOn(storage, 'getStorage').mockReturnValue({ exists: async (key: string) => key === 'file.epub' } as ReturnType<typeof storage.getStorage>)
    const fork = await forkLocalBook('author', 'version')
    expect(fork.bookVersionId).not.toBe('version')
    expect((await getIdeaDiscussion('member', idea.id)).idea.annotation.bookId).toBe('version')
    expect(await listAnnotations('author', fork.bookVersionId)).toEqual([])
    expect(await ideaComposerContext('author', fork.bookVersionId)).toMatchObject({ eligible: false })
  })

  it('removes a deleted account comments and promotes surviving replies', async () => {
    const idea = await createAnnotation('author', 'version', request)
    const parent = await createIdeaComment('outsider', idea.id, { body: 'deleted account text' })
    await createIdeaComment('member', idea.id, { body: 'remaining reply', replyToId: parent })
    await setIdeaLike('outsider', idea.id, true)
    db.delete(schema.users).where(eq(schema.users.id, 'outsider')).run()
    const result = await getIdeaDiscussion('member', idea.id)
    expect(result.comments.find((row) => row.id === parent)).toBeUndefined()
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]).toMatchObject({ body: 'remaining reply', parentId: null })
    expect(result.idea.likeCount).toBe(0)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('drops a deleted reply without a scar and rejects editing others or changing quotations', async () => {
    const idea = await createAnnotation('author', 'version', request)
    const parent = await createIdeaComment('member', idea.id, { body: 'parent' })
    const reply = await createIdeaComment('outsider', idea.id, { body: 'reply', replyToId: parent })
    await createIdeaComment('member', idea.id, { body: 'addressed reply', replyToId: reply })
    await expect(updateIdeaComment('manager', idea.id, reply, 'illegal edit')).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    await updateIdeaComment('outsider', idea.id, reply, 'edited reply')
    expect((await getIdeaDiscussion('member', idea.id)).comments.find((row) => row.id === reply)?.editedAt).toBeTruthy()
    await deleteIdeaComment('outsider', idea.id, reply)
    const after = await getIdeaDiscussion('member', idea.id)
    expect(after.comments.find((row) => row.id === reply)).toBeUndefined()
    expect(after.comments.find((row) => row.body === 'addressed reply')).toMatchObject({ parentId: parent, replyToId: null, replyToName: null })
    await expect(updateAnnotation('author', idea.id, { text: 'different quote' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const historical = await createAnnotation('author', 'version', { ...request, revisionId: null })
    // Legacy ideas without provenance stay locatable via CFI instead of being marked orphaned.
    expect((await listAnnotations('author', 'version')).find((row) => row.id === historical.id)?.locationAvailable).toBe(true)
  })

  it('upgrades historical private ideas without inventing provenance or publishing them', () => {
    const previous = new Database(':memory:')
    try {
      previous.pragma('foreign_keys = ON')
      const previousDb = drizzle(previous, { schema })
      migrateBeforeBookRetirement(previousDb, { migrationsFolder })
      client.retargetBookIdReferences(previousDb)
      previous.exec(fs.readFileSync(path.join(migrationsFolder, '0039_retire_legacy_books.sql'), 'utf8'))
      previous.exec(fs.readFileSync(path.join(migrationsFolder, '0040_retire_legacy_identity.sql'), 'utf8'))
      previous.exec("INSERT INTO users(id,username,created_at) VALUES ('author','author',1000); INSERT INTO book_versions(id,format,size,created_at,updated_at) VALUES ('version','epub',1,1000,1000); INSERT INTO ideas(id,user_id,book_version_id,created_at,updated_at) VALUES ('old','author','version',1000,1000);")
      previous.exec(fs.readFileSync(path.join(migrationsFolder, `${IDEA_DISCUSSION_TAG}.sql`), 'utf8'))
      expect(previous.prepare('SELECT visibility, revision_id, source_library_book_version_id FROM ideas').get()).toEqual({ visibility: 'private', revision_id: null, source_library_book_version_id: null })
      expect(previous.pragma('foreign_key_check')).toEqual([])
      expect(previous.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    } finally { previous.close() }
  })
})
