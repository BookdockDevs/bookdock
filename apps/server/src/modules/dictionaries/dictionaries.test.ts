import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { dictionaryLookupSchema } from '@bookdock/shared'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('../../config', () => ({ config: { get dataDir() { return state.directory } } }))
vi.mock('../../db/client', () => ({ getDb: () => db }))

import { errorHandler } from '../../middleware/error'
import { releaseDictionaryReader } from '../../lib/mdict-reader'
import { resetInstanceCache } from '../auth/auth.service'
import routes from './dictionaries.routes'
import { deleteDictionary, dictionaryCandidates, dictionaryResource, importDictionary, listDictionaries, lookupDictionary, reorderDictionaries, updateDictionary } from './dictionaries.service'
import { dictionaryFixture } from './dictionary-fixture'

const sqlite = new Database(':memory:')
const db = drizzle(sqlite)
const mdx = dictionaryFixture({ alias: '@@@LINK=hello', child: '<p>孩子</p>', 'hell-o': '<p>Not the exact word</p>', hello: '<p>你好 <a href="entry://child">child</a><img src="image.png"/><a href="sound://hello.wav">Listen</a></p>', run: '<p>跑</p>', zebra: '<p>斑马</p>' })
const mdd = dictionaryFixture({ '\\hello.wav': Buffer.from('RIFF sample audio'), '\\image.png': Buffer.from([137, 80, 78, 71]), '\\style.css': 'p {color: blue}' }, true)
const files = () => [new File([mdx], 'sample.mdx'), new File([mdd], 'sample.mdd')]
let id: string

beforeAll(async () => {
  state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookdock-dictionary-'))
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'reader\'),(\'other\'),(\'owner\'),(\'member\'); CREATE TABLE settings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,value TEXT NOT NULL); CREATE UNIQUE INDEX settings_user_key_idx ON settings(user_id,key); CREATE TABLE instance(id TEXT PRIMARY KEY, owner_user_id TEXT, registration_mode TEXT, allow_registration INTEGER NOT NULL DEFAULT 0, allow_guest_access INTEGER NOT NULL DEFAULT 0, upload_max_bytes INTEGER, allow_user_create_library INTEGER NOT NULL DEFAULT 1, allow_user_upload INTEGER NOT NULL DEFAULT 1, allow_user_resource_upload INTEGER NOT NULL DEFAULT 1, storage_backend_enabled INTEGER NOT NULL DEFAULT 0, storage_backend_connection_id TEXT, storage_backend_base_path TEXT NOT NULL DEFAULT \'/Bookdock/storage\', storage_backend_cache_max_mb INTEGER NOT NULL DEFAULT 2048, storage_backend_status TEXT NOT NULL DEFAULT \'disabled\', storage_backend_last_tested_at INTEGER, storage_backend_latency_ms INTEGER, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);')
})
afterAll(async () => { await releaseDictionaryReader(); sqlite.close(); await fs.rm(state.directory, { recursive: true, force: true }) })

describe('personal dictionaries', () => {
  it('imports and validates a real MDX/MDD binary bundle and deduplicates it', async () => {
    const result = await importDictionary('reader', files())
    id = result.id
    expect(result.name).toBe('Bookdock Test Dictionary')
    expect(result.fileNames).toEqual(['sample.mdx', 'sample.mdd'])
    expect((await importDictionary('reader', files())).id).toBe(id)
    expect(listDictionaries('reader').items).toHaveLength(1)
  })
  it('prefers exact headwords over stripped punctuation and follows entry redirects', async () => {
    const found = await lookupDictionary('reader', id, 'hello')
    expect(found.headword).toBe('hello')
    expect(found.html).toContain('你好')
    expect((await lookupDictionary('reader', id, 'alias')).headword).toBe('hello')
    expect((await lookupDictionary('reader', id, 'running')).headword).toBe('run')
    expect((await lookupDictionary('reader', id, 'children')).headword).toBe('child')
    expect((await lookupDictionary('reader', id, 'unmatched')).headword).toBeNull()
    expect(listDictionaries('reader').lastUsedId).toBe(id)
  })
  it('expands embedded MDX style markers and preserves unrecognized markers', async () => {
    const styled = dictionaryFixture({ alias: '@@@LINK=styled', styled: '`1`Word`2``2`definition`3`label`99`literal' }, false, '1\n<b>\n</b>\n2\n<br>\n\n3\n<i>\n</i>\n')
    const imported = await importDictionary('other', [new File([styled], 'styled.mdx')])
    const found = await lookupDictionary('other', imported.id, 'alias')
    expect(found.html).toBe('<b>Word</b><br><br>definition<i>label</i>`99`literal')
    await deleteDictionary('other', imported.id)
  })
  it('reads resource bytes without exposing filesystem paths', async () => {
    expect((await dictionaryResource('reader', id, 'image.png')).bytes).toEqual(Buffer.from([137, 80, 78, 71]))
    expect((await dictionaryResource('reader', id, 'hello.wav')).type).toBe('audio/wav')
    await expect(dictionaryResource('reader', id, '../image.png')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    await expect(dictionaryResource('reader', id, 'file:///etc/passwd')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
  })
  it('imports and serves companion loose CSS files alongside MDX', async () => {
    const cssBundle = [
      new File([mdx], 'styled_dict.mdx'),
      new File(['body { color: red; }'], 'custom.css'),
    ]
    const imported = await importDictionary('reader', cssBundle)
    expect(imported.fileNames).toEqual(['styled_dict.mdx', 'custom.css'])
    const res = await dictionaryResource('reader', imported.id, 'custom.css')
    expect(res.type).toBe('text/css')
    expect(res.bytes.toString('utf8')).toBe('body { color: red; }')
    const lookup = await lookupDictionary('reader', imported.id, 'hello')
    expect(lookup.html).toContain('<link rel="stylesheet" href="custom.css">')
    await deleteDictionary('reader', imported.id)
  })
  it('accepts multipart bundles and serves authenticated lookup and resource responses', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => { c.set('user', { id: 'reader', username: 'Reader', role: 'member', avatarKey: null }); c.set('guest', false); await next() })
    app.route('/api/v1/dictionaries', routes)
    const form = new FormData()
    files().forEach((file) => form.append('files', file))
    const imported = await app.request('/api/v1/dictionaries', { method: 'POST', body: form })
    expect(imported.status).toBe(201)
    expect((await imported.json()).data.id).toBe(id)
    const found = await app.request(`/api/v1/dictionaries/${id}/lookup?word=hello`)
    expect((await found.json()).data.headword).toBe('hello')
    const resource = await app.request(`/api/v1/dictionaries/${id}/resource?key=image.png`)
    expect(resource.status).toBe(200)
    expect(resource.headers.get('Content-Type')).toBe('image/png')
    expect(resource.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(new Uint8Array(await resource.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  })
  it('enforces ownership on all paths and respects disabled dictionaries', async () => {
    expect(listDictionaries('other').items).toEqual([])
    await expect(lookupDictionary('other', id, 'hello')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    await expect(dictionaryResource('other', id, 'image.png')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    await expect(deleteDictionary('other', id)).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    expect(() => updateDictionary('other', id, false)).toThrow()
    expect(() => reorderDictionaries('reader', [id, id])).toThrow()
    updateDictionary('reader', id, false)
    await expect(lookupDictionary('reader', id, 'hello')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    await expect(dictionaryResource('reader', id, 'image.png')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
    updateDictionary('reader', id, true)
  })
  it('rejects malformed bundles and leaves no published records', async () => {
    await expect(importDictionary('other', [new File(['not an mdx'], 'bad.mdx')])).rejects.toMatchObject({ code: 'DICTIONARY_INVALID' })
    await expect(importDictionary('other', [new File([mdx], 'sample.mdx'), new File([mdd], 'different.mdd')])).rejects.toMatchObject({ code: 'DICTIONARY_INVALID' })
    expect(listDictionaries('other').items).toEqual([])
    expect(dictionaryLookupSchema.safeParse({ word: 'x'.repeat(101) }).success).toBe(false)
    expect(dictionaryCandidates('“running”')).toContain('run')
  })
  it('rejects guests at the route boundary', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => { c.set('user', null); c.set('guest', true); await next() })
    app.route('/api/v1/dictionaries', routes)
    for (const endpoint of ['', `/${id}/lookup?word=hello`, `/${id}/resource?key=image.png`]) expect((await app.request('/api/v1/dictionaries' + endpoint)).status).toBe(401)
  })
  it('supports renaming and instance-scope sharing', async () => {
    const imported = await importDictionary('owner', files())
    expect(imported.scope).toBe('user')
    expect(imported.mine).toBe(true)

    // Member cannot change scope
    expect(() => updateDictionary('member', 'member', imported.id, { scope: 'instance' })).toThrow()

    // Owner renames and sets scope to instance
    const updated = updateDictionary('owner', 'owner', imported.id, { name: 'Shared Oxford', scope: 'instance' })
    expect(updated.items[0]!.name).toBe('Shared Oxford')
    expect(updated.items[0]!.scope).toBe('instance')

    // Member now sees the instance dictionary
    const memberList = listDictionaries('member')
    expect(memberList.items).toHaveLength(1)
    expect(memberList.items[0]!.id).toBe(imported.id)
    expect(memberList.items[0]!.name).toBe('Shared Oxford')
    expect(memberList.items[0]!.scope).toBe('instance')
    expect(memberList.items[0]!.mine).toBe(false)

    // Member can look up word from instance dictionary
    const lookupResult = await lookupDictionary('member', imported.id, 'hello')
    expect(lookupResult.headword).toBe('hello')

    // Member can rename it locally (even if scope: 'instance' is passed unchanged)
    const memberRenamed = updateDictionary('member', 'member', imported.id, { name: 'Member Local Name', scope: 'instance' })
    expect(memberRenamed.items[0]!.name).toBe('Member Local Name')
    expect(listDictionaries('owner').items[0]!.name).toBe('Shared Oxford')

    // Member cannot change scope of instance dictionary
    expect(() => updateDictionary('member', 'member', imported.id, { scope: 'user' })).toThrow()

    // Member can disable it independently without disabling it for owner
    updateDictionary('member', 'member', imported.id, { enabled: false })
    expect(listDictionaries('member').items[0]!.enabled).toBe(false)
    expect(listDictionaries('owner').items[0]!.enabled).toBe(true)

    // Member cannot delete instance dictionary
    await expect(deleteDictionary('member', 'member', imported.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Owner can delete instance dictionary
    await deleteDictionary('owner', 'owner', imported.id)
    expect(listDictionaries('member').items).toEqual([])
  })
  it('deletes the bundle and clears its remembered selection', async () => {
    await deleteDictionary('reader', id)
    expect(listDictionaries('reader')).toEqual({ items: [], lastUsedId: null })
    await expect(fs.stat(path.join(state.directory, 'dictionaries', 'reader', id))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lookupDictionary('reader', id, 'hello')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND' })
  })
  it('imports more dictionaries than the retired count limit allowed', async () => {
    for (let index = 0; index < 21; index++) {
      const bytes = dictionaryFixture({ [`word${index}`]: `<p>释义 ${index}</p>` })
      const imported = await importDictionary('other', [new File([bytes], `dict${index}.mdx`)])
      expect(imported.id).toBeDefined()
    }
    expect(listDictionaries('other').items.length).toBeGreaterThanOrEqual(21)
    const items = listDictionaries('other').items
    await Promise.all(items.map((item) => deleteDictionary('other', item.id)))
    expect(listDictionaries('other').items).toEqual([])
  }, 120_000)
  it('gates member imports behind allowUserResourceUpload while the owner stays exempt', async () => {
    sqlite.exec("INSERT INTO instance(id, owner_user_id, allow_user_resource_upload) VALUES ('instance', 'owner', 0)")
    resetInstanceCache()

    const memberApp = new Hono()
    memberApp.onError(errorHandler)
    memberApp.use('*', async (c, next) => { c.set('user', { id: 'reader', username: 'Reader', role: 'member', avatarKey: null }); c.set('guest', false); await next() })
    memberApp.route('/api/v1/dictionaries', routes)
    const memberForm = new FormData()
    files().forEach((file) => memberForm.append('files', file))
    const denied = await memberApp.request('/api/v1/dictionaries', { method: 'POST', body: memberForm })
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')

    const ownerApp = new Hono()
    ownerApp.onError(errorHandler)
    ownerApp.use('*', async (c, next) => { c.set('user', { id: 'owner', username: 'Owner', role: 'owner', avatarKey: null }); c.set('guest', false); await next() })
    ownerApp.route('/api/v1/dictionaries', routes)
    const ownerForm = new FormData()
    files().forEach((file) => ownerForm.append('files', file))
    const allowed = await ownerApp.request('/api/v1/dictionaries', { method: 'POST', body: ownerForm })
    expect(allowed.status).toBe(201)

    sqlite.exec("DELETE FROM instance")
    resetInstanceCache()
    await deleteDictionary('owner', 'owner', ((await allowed.json()) as { data: { id: string } }).data.id)
  })
  it.runIf(Boolean(process.env.BOOKDOCK_TEST_MDX))('imports and queries an explicitly supplied real MDX using disposable data', async () => {
    const filePath = process.env.BOOKDOCK_TEST_MDX!
    const bytes = await fs.readFile(filePath)
    const imported = await importDictionary('other', [new File([bytes], path.basename(filePath))])
    expect((await lookupDictionary('other', imported.id, 'hello')).headword).toBe('hello')
    expect((await lookupDictionary('other', imported.id, 'running')).headword).toBe('running')
    const dkny = await lookupDictionary('other', imported.id, 'DKNY')
    expect(dkny.html).toContain('Donna Karan New York')
    expect(dkny.html).toContain('<b style="font-size:180%;">dkny</b>')
    expect(dkny.html).not.toMatch(/`[1-4]`/)
    await deleteDictionary('other', imported.id)
  })
})
