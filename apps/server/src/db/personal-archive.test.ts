import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getBookDetail, getArchiveCover, getOverview } from '../modules/archive/archive.service'
import { getIdeaDiscussion } from '../modules/annotations/idea-discussion.service'
import { getReadingLedger } from '../modules/reading-records/reading-ledger.service'
import * as storage from '../storage'
import { blobKeyReferenced } from './blob-refs'
import * as client from './client'
import { migrateBeforeBookRetirement, migrateWithTagFilter, PERSONAL_ARCHIVE_TAG } from './migration-stage'
import * as schema from './schema'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
let sqlite: Database.Database
afterEach(() => { vi.restoreAllMocks(); sqlite?.close() })

describe('personal archive upgrade', () => {
  it('preserves notes, private reviews and interactions across upgrade and content deletion, with owner-only access', async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrateBeforeBookRetirement(db, { migrationsFolder })
    client.retargetBookIdReferences(db)
    migrateWithTagFilter(db, { migrationsFolder }, (entry) => entry.tag !== PERSONAL_ARCHIVE_TAG)
    sqlite.exec(`
      INSERT INTO users(id, username, created_at) VALUES ('owner','Owner',1), ('other','Other',1);
      INSERT INTO libraries(id,user_id,type,name,created_at,updated_at) VALUES ('private','owner','private','Private',1,1);
      INSERT INTO book_versions(id,format,size,created_at,updated_at) VALUES ('version','epub',100,1,1);
      INSERT INTO library_books(id,library_id,user_id,title,author,cover_key,created_at,updated_at) VALUES ('work','private','owner','Private title','Writer','cover.jpg',1,1);
      INSERT INTO library_book_versions(id,library_id,library_book_id,book_version_id,kind,created_at,updated_at) VALUES ('link','private','work','version','personal',1,1);
      INSERT INTO highlights(id,user_id,book_version_id,cfi_range,text,created_at,updated_at) VALUES ('highlight','owner','version','cfi','Quote',1,1), ('other-highlight','other','version','other-cfi','Other quote',1,1);
      INSERT INTO bookmarks(id,user_id,book_version_id,cfi,title,context_text,created_at,updated_at) VALUES ('bookmark','owner','version','mark','Title','Context',1,1);
      INSERT INTO ideas(id,user_id,book_version_id,cfi_range,text,note,created_at,updated_at) VALUES ('idea','owner','version','idea-cfi','Quoted text','My idea',1,1);
      INSERT INTO idea_comments(id,idea_id,user_id,body,created_at) VALUES ('comment','idea','owner','Comment',1);
      INSERT INTO idea_comments(id,idea_id,user_id,parent_id,reply_to_id,body,created_at) VALUES ('reply','idea','other','comment','comment','Reply',2);
      INSERT INTO idea_likes(idea_id,user_id,created_at) VALUES ('idea','other',1);
      INSERT INTO idea_comment_likes(comment_id,user_id,created_at) VALUES ('reply','owner',1);
      INSERT INTO book_reviews(id,user_id,private_library_book_id,body,created_at,updated_at) VALUES ('review','owner','work','Review',1,1);
      INSERT INTO book_review_comments(id,review_id,user_id,body,created_at) VALUES ('review-comment','review','other','Comment',1);
      INSERT INTO book_review_likes(review_id,user_id,created_at) VALUES ('review','other',1);
      INSERT INTO book_review_comment_likes(comment_id,user_id,created_at) VALUES ('review-comment','owner',1);
      INSERT INTO blobs(key,size,kind,created_at) VALUES ('image.webp',10,'content',1);
      INSERT INTO content_files(id,user_id,domain,kind,draft_id,book_version_id,idea_id,blob_key,name,mime_type,size,ready,created_at)
        VALUES ('image','owner','idea','image','draft','version','idea','image.webp','image.webp','image/webp',10,1,1);
      INSERT INTO content_files(id,user_id,domain,kind,draft_id,book_version_id,review_id,blob_key,name,mime_type,size,ready,created_at)
        VALUES ('review-file','owner','review','attachment','review-draft','version','review','image.webp','review-file.txt','text/plain',10,1,1);
    `)
    const tables = ['highlights', 'bookmarks', 'ideas', 'idea_comments', 'idea_likes', 'idea_comment_likes', 'book_review_comments', 'book_review_likes', 'book_review_comment_likes', 'content_files']
    const before = tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all())
    migrate(db, { migrationsFolder })
    expect(tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, 'owner')).get()).toMatchObject({ title: 'Private title', author: 'Writer', format: 'epub', coverKey: 'cover.jpg' })
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, 'other')).get()).toMatchObject({ title: 'Unavailable book', coverKey: null })
    expect(db.select().from(schema.bookReviews).get()?.readBookVersionId).toBe('version')
    db.delete(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'work')).run()
    db.delete(schema.bookVersions).where(eq(schema.bookVersions.id, 'version')).run()
    expect(tables.map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(1)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue({ exists: async (key: string) => key === 'cover.jpg', get: async () => Readable.from(Buffer.from('cover')) } as unknown as ReturnType<typeof storage.getStorage>)
    const detail = await getBookDetail('owner', 'version')
    expect(detail.annotations).toHaveLength(3)
    expect(detail.annotations.every((entry) => entry.locationAvailable === false)).toBe(true)
    expect(detail.reviews).toHaveLength(1)
    expect((await getOverview('owner')).counts.total).toBe(4)
    expect((await getReadingLedger('owner', 'version')).sourceAvailable).toBe(false)
    expect((await getIdeaDiscussion('owner', 'idea')).idea.locationAvailable).toBe(false)
    await expect(getIdeaDiscussion('other', 'idea')).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' })
    expect((await getBookDetail('other', 'version')).annotations.map((entry) => entry.id)).toEqual(['other-highlight'])
    expect((await getArchiveCover('owner', 'version')).data.toString()).toBe('cover')
    await expect(getArchiveCover('other', 'version')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(blobKeyReferenced('cover.jpg')).toBe(true)
    db.delete(schema.libraries).where(eq(schema.libraries.id, 'private')).run()
    db.delete(schema.users).where(eq(schema.users.id, 'owner')).run()
    expect(db.select().from(schema.highlights).all().map((row) => row.id)).toEqual(['other-highlight'])
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(0)
    expect(db.select().from(schema.ideas).all()).toHaveLength(0)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
